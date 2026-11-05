import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { agents, budgetReservations, issues, type Db } from "@paperclipai/db";
import { centsToUnits, unitsToCents } from "@paperclipai/shared";
import type { AdapterExecutionResult, ServerAdapterModule } from "../adapters/index.js";
import { requireServerAdapter } from "../adapters/registry.js";
import { withAccountingTransaction } from "./accounting-transaction.js";
import { budgetServiceInTransaction } from "./budgets.js";
import { createCostEventInTransaction } from "./costs.js";
import { providerUsageReceipt } from "./provider-usage.js";
import { secretService } from "./secrets.js";
import { resolveExecutionRunAdapterConfig } from "./heartbeat/run-preparation.js";

/**
 * Council turns deliberately do not create heartbeat runs. Heartbeat runs own
 * workspace leases, tool credentials, sessions, lifecycle recovery and provider
 * stop records; fabricating one here would make this small text-only operation
 * an alternate path around those controls. The adapter contract is safe for a
 * fresh, local invocation when all of those optional capabilities are absent.
 */

const DEFAULT_DEADLINE_MS = 60_000;
const DEFAULT_MAX_OUTPUT_CHARS = 12_000;
const MAX_OUTPUT_CHARS = 50_000;

export const COUNCIL_AGENT_ADAPTER_TYPES = ["hermes_gateway"] as const;

export function isCouncilAgentAdapterType(type: string | null | undefined): type is (typeof COUNCIL_AGENT_ADAPTER_TYPES)[number] {
  return typeof type === "string" && (COUNCIL_AGENT_ADAPTER_TYPES as readonly string[]).includes(type);
}

/** Matches the heartbeat execution-start gate, with Council's stricter error-state exclusion. */
export function isAgentInvokableForCouncil(agent: Pick<typeof agents.$inferSelect, "status" | "lifecycleState">): boolean {
  return agent.lifecycleState === "ready" &&
    agent.status !== "paused" &&
    agent.status !== "terminated" &&
    agent.status !== "pending_approval" &&
    agent.status !== "error" &&
    agent.status !== "deleted";
}

export type CouncilAgentTurnErrorCode =
  | "agent_not_found"
  | "agent_not_invokable"
  | "timeout"
  | "aborted"
  | "empty_reply"
  | "adapter_error";

export class CouncilAgentTurnError extends Error {
  constructor(readonly code: CouncilAgentTurnErrorCode, message: string) {
    super(message);
    this.name = "CouncilAgentTurnError";
  }
}

type Secrets = Pick<ReturnType<typeof secretService>,
  "resolveAdapterConfigForRuntime" | "resolveEnvBindings" | "collectMissingRuntimeBindings" | "collectMissingAdapterConfigRuntimeBindings">;

export interface CouncilAgentTurnDependencies {
  adapter?: (type: string) => ServerAdapterModule;
  secrets?: Secrets;
  now?: () => Date;
}

export interface CouncilAgentTurnInput {
  companyId: string;
  agentId: string;
  issueId: string;
  prompt: string;
  attemptKey: string;
  signal: AbortSignal;
  deadlineMs?: number;
  maxOutputChars?: number;
  maxOutputTokens?: number;
}

export interface CouncilAgentTurnResult {
  text: string;
  model?: string;
  provider?: string;
  usage?: { inputTokens: number; outputTokens: number; costCents?: string };
  durationMs: number;
}

function bounded(value: number | undefined, fallback: number, maximum: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value!), maximum)) : fallback;
}

function outputFrom(result: AdapterExecutionResult, logs: string[], redact: (value: string) => string) {
  const body = result.resultJson ?? {};
  const candidate = [body.text, body.output, body.stdout, result.summary, ...logs]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? "";
  return redact(candidate)
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .split("\n")
    .filter((line) => !/^\s*(?:\[[^\]]+\]\s*)?(?:debug|info|warn(?:ing)?|error)\b/i.test(line))
    .join("\n")
    .trim();
}

function resolvedStringValues(value: unknown, result = new Set<string>()): string[] {
  if (typeof value === "string") {
    if (value.length >= 6) result.add(value);
    return [...result];
  }
  if (Array.isArray(value)) {
    for (const item of value) resolvedStringValues(item, result);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) resolvedStringValues(item, result);
  }
  return [...result];
}

function redactResolvedText(value: string, secrets: readonly string[]) {
  let redacted = value;
  for (const secret of secrets) redacted = redacted.replaceAll(secret, "[redacted]");
  return redacted;
}

function safeAdapterMessage(error: unknown, secrets: readonly string[]) {
  let message = error instanceof Error ? error.message : "Adapter execution failed";
  message = redactResolvedText(message, secrets);
  return message.slice(0, 500) || "Adapter execution failed";
}

async function reserveCouncilTurn(db: Db, companyId: string, agentId: string) {
  return withAccountingTransaction(db, companyId, async (tx) => {
    const { block, policies, observations } = await budgetServiceInTransaction(tx, []).evaluateAdmission(companyId, agentId, {});
    if (block) return null;
    const amount = policies.reduce((maximum, policy) => {
      const cents = centsToUnits(policy.reservationCents);
      return cents > maximum ? cents : maximum;
    }, 0n);
    for (const [index, policy] of policies.entries()) {
      const committed = centsToUnits(observations[index].ledgerCents) + centsToUnits(observations[index].effectiveHeldCents);
      if (committed + amount > centsToUnits(policy.amount)) return null;
    }
    const [reservation] = await tx.insert(budgetReservations).values({
      companyId, agentId, fastResponseRequestId: randomUUID(), amountCents: unitsToCents(amount), providerStartedAt: new Date(),
    }).returning({ id: budgetReservations.id });
    return reservation.id;
  });
}

async function settleCouncilReservation(db: Db, companyId: string, reservationId: string, state: "settled" | "released") {
  await withAccountingTransaction(db, companyId, (tx) => tx.update(budgetReservations).set({ state, settledAt: new Date() })
    .where(and(eq(budgetReservations.companyId, companyId), eq(budgetReservations.id, reservationId), eq(budgetReservations.state, "held"))));
}

export function createCouncilAgentTurnService(db: Db, deps: CouncilAgentTurnDependencies = {}) {
  const adapterFor = deps.adapter ?? requireServerAdapter;
  const secrets = deps.secrets ?? secretService(db);
  const now = deps.now ?? (() => new Date());
  // This is only a short-lived reply cache for an in-process delivery retry.
  // The cost ledger remains the durable idempotency authority.
  const completedAttempts = new Map<string, CouncilAgentTurnResult>();
  const inFlightAttempts = new Map<string, Promise<CouncilAgentTurnResult>>();

  async function executeAgentTurn(input: CouncilAgentTurnInput): Promise<CouncilAgentTurnResult> {
    const startedAt = Date.now();
    const deadlineMs = bounded(input.deadlineMs, DEFAULT_DEADLINE_MS, DEFAULT_DEADLINE_MS);
    const maxOutputChars = bounded(input.maxOutputChars, DEFAULT_MAX_OUTPUT_CHARS, MAX_OUTPUT_CHARS);
    if (input.signal.aborted) throw new CouncilAgentTurnError("aborted", "Council agent turn was cancelled");
    const attemptCacheKey = `${input.companyId}:${input.attemptKey}`;
    const completed = completedAttempts.get(attemptCacheKey);
    if (completed) return completed;

    const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, input.companyId), eq(agents.id, input.agentId))).limit(1);
    if (!agent) throw new CouncilAgentTurnError("agent_not_found", "Council agent was not found");
    if (!isAgentInvokableForCouncil(agent)) {
      throw new CouncilAgentTurnError("agent_not_invokable", "Council agent is not invokable in its current state");
    }
    if (!isCouncilAgentAdapterType(agent.adapterType)) {
      throw new CouncilAgentTurnError("agent_not_invokable", "Only Hermes gateway agents can join war rooms");
    }
    const [issue] = await db.select({ id: issues.id }).from(issues)
      .where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId))).limit(1);
    if (!issue) throw new CouncilAgentTurnError("adapter_error", "Council issue was not found");

    let resolved: Awaited<ReturnType<typeof resolveExecutionRunAdapterConfig>>;
    try {
      resolved = await resolveExecutionRunAdapterConfig({
        companyId: input.companyId,
        agentId: agent.id,
        adapterType: agent.adapterType,
        issueId: input.issueId,
        executionRunConfig: agent.adapterConfig,
        projectEnv: null,
        secretsSvc: secrets,
      });
    } catch {
      throw new CouncilAgentTurnError("adapter_error", "Council agent configuration could not be resolved");
    }
    const resolvedSecrets = resolvedStringValues(resolved.resolvedConfig);
    const redact = (value: string) => redactResolvedText(value, resolvedSecrets);

    const reservationId = await reserveCouncilTurn(db, input.companyId, agent.id);
    if (!reservationId) throw new CouncilAgentTurnError("adapter_error", "Budget limit reached");

    let timedOut = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Council agent turn deadline exceeded"));
    }, deadlineMs);
    const abort = () => controller.abort(input.signal.reason);
    input.signal.addEventListener("abort", abort, { once: true });
    // The caller may have aborted during the lookups above, before this listener existed.
    if (input.signal.aborted) abort();
    const logs: string[] = [];
    let result: AdapterExecutionResult;
    const occurredAt = now();
    try {
      const adapter = adapterFor(agent.adapterType);
      result = await adapter.execute({
        runId: `council:${input.attemptKey}:${randomUUID()}`,
        agent,
        runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
        config: { ...resolved.resolvedConfig, sessionKeyStrategy: "none" },
        context: {
          task: input.prompt,
          issueId: input.issueId,
          council: {
            oneShot: true,
            toolsAllowed: false,
            workspaceAllowed: false,
            ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
          },
        },
        onLog: async (stream, chunk) => { if (stream === "stdout" && logs.join("").length < maxOutputChars) logs.push(redact(chunk)); },
        signal: controller.signal,
      });
    } catch (error) {
      await settleCouncilReservation(db, input.companyId, reservationId, "released");
      if (timedOut) throw new CouncilAgentTurnError("timeout", "Council agent turn timed out");
      if (input.signal.aborted) throw new CouncilAgentTurnError("aborted", "Council agent turn was cancelled");
      throw new CouncilAgentTurnError("adapter_error", safeAdapterMessage(error, resolvedSecrets));
    } finally {
      clearTimeout(timeout);
      input.signal.removeEventListener("abort", abort);
    }
    if (timedOut || result.timedOut) {
      await settleCouncilReservation(db, input.companyId, reservationId, "released");
      throw new CouncilAgentTurnError("timeout", "Council agent turn timed out");
    }
    if (input.signal.aborted) {
      await settleCouncilReservation(db, input.companyId, reservationId, "released");
      throw new CouncilAgentTurnError("aborted", "Council agent turn was cancelled");
    }
    if ((result.exitCode ?? 0) !== 0 || result.errorMessage) {
      await settleCouncilReservation(db, input.companyId, reservationId, "released");
      throw new CouncilAgentTurnError("adapter_error", safeAdapterMessage(result.errorMessage ?? "Adapter execution failed", resolvedSecrets));
    }

    const text = outputFrom(result, logs, redact).slice(0, maxOutputChars);
    if (!text) {
      await settleCouncilReservation(db, input.companyId, reservationId, "released");
      throw new CouncilAgentTurnError("empty_reply", "Council agent returned an empty reply");
    }
    const receipt = providerUsageReceipt({
      usage: result.usage,
      response: { id: result.providerRequestId },
      providerMetadata: { openrouter: { usage: { cost: result.cacheAdjustedCostUsd ?? result.costUsd } } },
    });
    await withAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await createCostEventInTransaction(tx, input.companyId, {
        usageKind: "fast_response", agentId: agent.id, responsibleUserId: null,
        issueId: input.issueId, projectId: null, heartbeatRunId: null,
        idempotencyKey: `council:${input.attemptKey}`, billingCode: `council:${input.issueId}`,
        provider: result.provider ?? agent.adapterType, biller: result.biller ?? result.provider ?? agent.adapterType,
        model: result.model ?? agent.adapterType, billingType: result.billingType ?? "metered_api",
        costStatus: receipt.costStatus, inputTokens: receipt.inputTokens ?? 0,
        outputTokens: receipt.outputTokens ?? 0, costCents: receipt.costCents ?? "0",
        providerRequestId: receipt.providerRequestId, pricingProvenance: receipt.pricingProvenance,
        occurredAt,
      }, publications, { actorType: "agent", actorId: agent.id, agentId: agent.id });
      await tx.update(budgetReservations).set({ state: "settled", settledAt: new Date() })
        .where(and(eq(budgetReservations.companyId, input.companyId), eq(budgetReservations.id, reservationId), eq(budgetReservations.state, "held")));
    });
    const response = {
      text, model: result.model ?? undefined, provider: result.provider ?? undefined,
      ...(result.usage ? { usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, ...(receipt.costCents ? { costCents: receipt.costCents } : {}) } } : {}),
      durationMs: Date.now() - startedAt,
    };
    completedAttempts.set(attemptCacheKey, response);
    while (completedAttempts.size > 1_000) completedAttempts.delete(completedAttempts.keys().next().value!);
    return response;
  }

  function runAgentTurn(input: CouncilAgentTurnInput): Promise<CouncilAgentTurnResult> {
    const attemptCacheKey = `${input.companyId}:${input.attemptKey}`;
    const existing = inFlightAttempts.get(attemptCacheKey);
    if (existing) return existing;
    const attempt = executeAgentTurn(input);
    inFlightAttempts.set(attemptCacheKey, attempt);
    void attempt.finally(() => { inFlightAttempts.delete(attemptCacheKey); }).catch(() => undefined);
    return attempt;
  }

  return { runAgentTurn };
}
