import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, budgetPolicies, companies, costEvents, createDb, issues } from "@paperclipai/db";
import type { ServerAdapterModule } from "../adapters/index.js";
import { CouncilAgentTurnError, createCouncilAgentTurnService } from "../services/council-agent-turn.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { execute as executeHermesGateway } from "@paperclipai/hermes-paperclip-adapter/gateway/server";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbedded = support.supported ? describe : describe.skip;

describeEmbedded("Council agent turn service", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-council-agent-turn-");
    db = createDb(database.connectionString);
  }, 20_000);

  afterAll(async () => { await database.cleanup(); });

  async function fixture(status = "idle") {
    const companyId = randomUUID(), otherCompanyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID();
    await db.insert(companies).values([
      { id: companyId, name: "Council", issuePrefix: `C${companyId.slice(0, 5).toUpperCase()}`, requireBoardApprovalForNewAgents: false },
      { id: otherCompanyId, name: "Other", issuePrefix: `O${otherCompanyId.slice(0, 5).toUpperCase()}`, requireBoardApprovalForNewAgents: false },
    ]);
    await db.insert(issues).values({ id: issueId, companyId, title: "Room" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Council agent", adapterType: "hermes_gateway", status, lifecycleState: "ready" });
    return { companyId, otherCompanyId, agentId, issueId };
  }

  function service(execute: ServerAdapterModule["execute"], secret = "council-secret", config: Record<string, unknown> = { env: { TOKEN: secret }, nested: { credential: secret } }) {
    return createCouncilAgentTurnService(db, {
      adapter: () => ({ type: "hermes_gateway", execute } as ServerAdapterModule),
      secrets: {
        resolveAdapterConfigForRuntime: vi.fn().mockResolvedValue({
          config, secretKeys: new Set(["TOKEN"]), manifest: [],
        }),
      } as never,
    });
  }

  function input(f: Awaited<ReturnType<typeof fixture>>, signal = new AbortController().signal) {
    return { ...f, prompt: "Give a concise answer", attemptKey: randomUUID(), signal };
  }

  it("runs a fresh no-tools, no-workspace adapter turn and records usage once", async () => {
    const f = await fixture();
    const execute = vi.fn(async (ctx) => {
      expect(ctx.runtime).toEqual({ sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null });
      expect(ctx.runtimeTools).toBeUndefined();
      expect(ctx.runtimeMcp).toBeUndefined();
      expect(ctx.executionTarget).toBeUndefined();
      expect(ctx.getFreshSessionHandoff).toBeUndefined();
      expect(ctx.config).toMatchObject({ sessionKeyStrategy: "none" });
      expect(ctx.context).toMatchObject({ task: "Give a concise answer", council: { oneShot: true, toolsAllowed: false, workspaceAllowed: false } });
      return { exitCode: 0, signal: null, timedOut: false, resultJson: { text: "Useful answer" }, usage: { inputTokens: 11, outputTokens: 7 }, provider: "test", model: "test-model", costUsd: 0.02 };
    });
    const turn = service(execute);
    const request = input(f);
    await expect(turn.runAgentTurn(request)).resolves.toMatchObject({ text: "Useful answer", provider: "test", model: "test-model", usage: { inputTokens: 11, outputTokens: 7 } });
    await expect(turn.runAgentTurn(request)).resolves.toMatchObject({ text: "Useful answer" });
    const rows = await db.select().from(costEvents).where(and(eq(costEvents.companyId, f.companyId), eq(costEvents.idempotencyKey, `council:${request.attemptKey}`)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ usageKind: "fast_response", agentId: f.agentId, issueId: f.issueId, billingCode: `council:${f.issueId}`, inputTokens: 11, outputTokens: 7 });
  });

  it("strips tool payload fields and forwards a 64-token cap to the Hermes gateway", async () => {
    const f = await fixture();
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(
      String(url).endsWith("/v1/runs")
        ? { run_id: "run-hermes-1", status: "completed", output: "Capped reply" }
        : { status: "completed", output: "Capped reply" },
    ), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(service(executeHermesGateway as ServerAdapterModule["execute"], "council-secret", {
      apiBaseUrl: "http://127.0.0.1:8642", apiKey: "council-secret",
      payloadTemplate: { tools: ["deploy"], toolsets: ["terminal"], workspace: "/tmp/council", cwd: "/tmp/council", mcp: { enabled: true }, keep: "value" },
    }).runAgentTurn({ ...input(f), maxOutputTokens: 64 })).resolves.toMatchObject({ text: "Capped reply" });
    const call = (fetchMock.mock.calls as Array<[RequestInfo | URL, RequestInit?]>).find(([url]) => String(url).endsWith("/v1/runs"));
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({ keep: "value", max_tokens: 64 });
    for (const key of ["tools", "toolsets", "workspace", "cwd", "mcp"]) expect(body).not.toHaveProperty(key);
  });

  it("admits only the agent turns that fit the held Council budget estimate", async () => {
    const f = await fixture();
    await db.insert(budgetPolicies).values({
      companyId: f.companyId, scopeType: "company", scopeId: f.companyId,
      windowKind: "calendar_month_utc", amount: 30, reservationCents: "20",
    });
    let release: (() => void) | undefined;
    const execute = vi.fn(() => new Promise<Awaited<ReturnType<ServerAdapterModule["execute"]>>>((resolve) => {
      release = () => resolve({ exitCode: 0, signal: null, timedOut: false, resultJson: { text: "first" } });
    }));
    const turn = service(execute);
    const first = turn.runAgentTurn(input(f));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await expect(turn.runAgentTurn({ ...input(f), attemptKey: randomUUID() })).rejects.toMatchObject({
      code: "adapter_error", message: "Budget limit reached",
    });
    release?.();
    await expect(first).resolves.toMatchObject({ text: "first" });
  });

  it("rejects a caller abort and deadline as typed cancellation errors", async () => {
    const f = await fixture();
    const execute = vi.fn((ctx) => new Promise<never>((_resolve, reject) => {
      if (ctx.signal?.aborted) reject(new Error("stopped"));
      else ctx.signal?.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
    }));
    const turn = service(execute);
    await expect(turn.runAgentTurn({ ...input(f), deadlineMs: 5 })).rejects.toMatchObject({ code: "timeout" } satisfies Partial<CouncilAgentTurnError>);
    const controller = new AbortController();
    const pending = turn.runAgentTurn(input(f, controller.signal));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" } satisfies Partial<CouncilAgentTurnError>);
  });

  it("rejects cross-company and paused agents before dispatch", async () => {
    const f = await fixture("paused");
    const execute = vi.fn();
    await expect(service(execute).runAgentTurn(input(f))).rejects.toMatchObject({ code: "agent_not_invokable" });
    await expect(service(execute).runAgentTurn({ ...input(f), companyId: f.otherCompanyId })).rejects.toMatchObject({ code: "agent_not_found" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects non-Hermes adapters before dispatch", async () => {
    const f = await fixture();
    await db.update(agents).set({ adapterType: "codex_local" }).where(eq(agents.id, f.agentId));
    const execute = vi.fn();
    await expect(service(execute).runAgentTurn(input(f))).rejects.toMatchObject({
      code: "agent_not_invokable", message: "Only Hermes gateway agents can join war rooms",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects empty replies and caps cleaned adapter output", async () => {
    const f = await fixture();
    await expect(service(async () => ({ exitCode: 0, signal: null, timedOut: false, resultJson: { stdout: "INFO startup\n" } }))
      .runAgentTurn(input(f))).rejects.toMatchObject({ code: "empty_reply" });
    await expect(service(async () => ({ exitCode: 0, signal: null, timedOut: false, resultJson: { stdout: "INFO startup\nabcdefgh" } }))
      .runAgentTurn({ ...input(f), maxOutputChars: 4 })).resolves.toMatchObject({ text: "abcd" });
  });

  it("redacts resolved secrets from output, logs, and failures", async () => {
    const f = await fixture();
    await expect(service(async () => ({ exitCode: 0, signal: null, timedOut: false, resultJson: { text: "answer council-secret" } })).runAgentTurn(input(f)))
      .resolves.toMatchObject({ text: "answer [redacted]" });
    await expect(service(async (ctx) => {
      await ctx.onLog("stdout", "answer council-secret");
      return { exitCode: 0, signal: null, timedOut: false };
    }).runAgentTurn(input(f))).resolves.toMatchObject({ text: "answer [redacted]" });
    await expect(service(async () => { throw new Error("provider rejected council-secret"); }).runAgentTurn(input(f)))
      .rejects.toMatchObject({ code: "adapter_error", message: "provider rejected [redacted]" });
  });

  it("shares concurrent calls for the same attempt", async () => {
    const f = await fixture();
    let release: (() => void) | undefined;
    const execute = vi.fn(() => new Promise<Awaited<ReturnType<ServerAdapterModule["execute"]>>>((resolve) => {
      release = () => resolve({ exitCode: 0, signal: null, timedOut: false, resultJson: { text: "once" } });
    }));
    const turn = service(execute);
    const request = input(f);
    const first = turn.runAgentTurn(request);
    const second = turn.runAgentTurn(request);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    release?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ text: "once" }),
      expect.objectContaining({ text: "once" }),
    ]);
    expect(execute).toHaveBeenCalledOnce();
  });
});
