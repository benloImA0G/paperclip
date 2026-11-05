import { describe, expect, it, vi } from "vitest";
import { agents, councilSeats, issues, toolConnections } from "@paperclipai/db";

vi.mock("../services/ai-connections.js", () => ({ aiConnectionService: () => ({}) }));
vi.mock("../services/issues.js", () => ({ issueService: () => ({}) }));
vi.mock("../services/accounting-transaction.js", () => ({ withAccountingTransaction: vi.fn() }));
vi.mock("../services/budgets.js", () => ({ budgetServiceInTransaction: vi.fn() }));
vi.mock("../services/costs.js", () => ({ createCostEventInTransaction: vi.fn() }));
vi.mock("../services/fast-response-provider.js", () => ({ fastResponseModel: vi.fn() }));
vi.mock("../services/provider-usage.js", () => ({ providerUsageReceipt: vi.fn() }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));

const companyId = "11111111-1111-4111-8111-111111111111";
const otherCompanyId = "33333333-3333-4333-8333-333333333333";
const issueId = "22222222-2222-4222-8222-222222222222";

type Seat = Record<string, unknown>;

function dbFor(agentRows: Array<Record<string, unknown>>, existingSeats: Seat[] = []) {
  const seats = [...existingSeats];
  const scopedAgents = agentRows.filter((agent) => (agent.companyId ?? companyId) === companyId);
  const room = { id: issueId, companyId, originKind: "council", description: "Council room" };
  const chain = (rows: unknown[]) => {
    const result = Object.assign(Promise.resolve(rows), {
      limit: async () => rows,
      orderBy: async () => rows,
      for: async () => rows,
    });
    return result;
  };
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        innerJoin: () => ({ where: () => chain([{ connectionId: "connection" }]) }),
        where: () => chain(table === issues ? [room] : table === agents ? scopedAgents : table === councilSeats ? seats : table === toolConnections ? [{ connectionId: "connection" }] : []),
      }),
    }),
    transaction: async (fn: (tx: typeof db) => unknown) => fn(db),
    insert: () => ({
      values: (value: Seat) => ({
        returning: async () => {
          const seat = {
            id: `seat-${seats.length + 1}`,
            active: true,
            position: seats.length,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...value,
          };
          seats.push(seat);
          return [seat];
        },
      }),
    }),
    update: () => ({
      set: (value: Seat) => ({
        where: async () => {
          for (const seat of seats) Object.assign(seat, value);
          return [];
        },
      }),
    }),
  };
  return { db: db as never, seats };
}

async function serviceFor(agentRows: Array<Record<string, unknown>>, seats?: Seat[]) {
  const { councilChatService } = await import("../services/council-chat.js");
  const fixture = dbFor(agentRows, seats);
  return { service: councilChatService(fixture.db), ...fixture };
}

describe("council agent seats", () => {
  it("creates an invokable agent seat with the agent name and adapter label", async () => {
    const { service } = await serviceFor([{ id: "agent-1", name: "Researcher", adapterType: "hermes_gateway", status: "idle", lifecycleState: "ready" }]);

    await expect(service.addSeat(companyId, issueId, { kind: "agent", agentId: "agent-1" })).resolves.toMatchObject({
      kind: "agent", agentId: "agent-1", name: "Researcher", adapterTypeLabel: "Agent",
    });
    await expect(service.listSeats(companyId, issueId)).resolves.toEqual([
      expect.objectContaining({ kind: "agent", agentId: "agent-1", adapterTypeLabel: "hermes_gateway" }),
    ]);
  });

  it("rejects an agent from another company", async () => {
    const { service } = await serviceFor([{ id: "other-agent", companyId: otherCompanyId, name: "Other", adapterType: "hermes_gateway", status: "idle", lifecycleState: "ready" }]);
    await expect(service.addSeat(companyId, issueId, { kind: "agent", agentId: "other-agent" })).rejects.toMatchObject({ status: 422 });
  });

  it("rejects local CLI agents because only Hermes gateway agents can join", async () => {
    const { service } = await serviceFor([{ id: "agent-1", name: "Local", adapterType: "codex_local", status: "idle", lifecycleState: "ready" }]);
    await expect(service.addSeat(companyId, issueId, { kind: "agent", agentId: "agent-1" })).rejects.toMatchObject({ status: 422 });
  });

  it("rejects an agent that is not ready", async () => {
    const { service } = await serviceFor([{ id: "agent-1", name: "Starting", adapterType: "hermes_gateway", status: "idle", lifecycleState: "provisioning" }]);
    await expect(service.addSeat(companyId, issueId, { kind: "agent", agentId: "agent-1" })).rejects.toMatchObject({ status: 422 });
  });

  it("rejects a paused agent", async () => {
    const { service } = await serviceFor([{ id: "agent-1", name: "Paused", adapterType: "hermes_gateway", status: "paused" }]);
    await expect(service.addSeat(companyId, issueId, { kind: "agent", agentId: "agent-1" })).rejects.toMatchObject({ status: 422 });
  });

  it("keeps the eight-seat cap and one moderator", async () => {
    const eightSeats = Array.from({ length: 8 }, (_, position) => ({ id: `seat-${position}`, companyId, issueId, fallbacks: { fallbacks: [], role: "none" }, seatKind: "agent", agentId: `agent-${position}` }));
    const cap = await serviceFor([{ id: "agent-8", name: "Ninth", adapterType: "hermes_gateway", status: "idle", lifecycleState: "ready" }], eightSeats);
    await expect(cap.service.addSeat(companyId, issueId, { kind: "agent", agentId: "agent-8" })).rejects.toMatchObject({ status: 409 });

    const { service, seats } = await serviceFor([
      { id: "agent-1", name: "First", adapterType: "hermes_gateway", status: "idle", lifecycleState: "ready" },
      { id: "agent-2", name: "Second", adapterType: "hermes_gateway", status: "idle", lifecycleState: "ready" },
    ]);
    await service.addSeat(companyId, issueId, { kind: "agent", agentId: "agent-1", role: "moderator" });
    await service.addSeat(companyId, issueId, { kind: "agent", agentId: "agent-2", role: "moderator" });
    expect(seats.filter((seat) => (seat.fallbacks as { role: string }).role === "moderator")).toHaveLength(1);
  });

  it("continues to create model seats", async () => {
    const { service } = await serviceFor([]);
    await expect(service.addSeat(companyId, issueId, {
      name: "Model seat", connectionId: "11111111-1111-4111-8111-111111111112", grantId: "11111111-1111-4111-8111-111111111113", model: "test-model",
    })).resolves.toMatchObject({ kind: "model", agentId: null, model: "test-model" });
  });
});
