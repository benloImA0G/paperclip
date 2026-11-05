// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CouncilAgentPanel } from "./CouncilAgentPanel";
import { queryKeys } from "../lib/queryKeys";

const agentsApi = vi.hoisted(() => ({ list: vi.fn() }));
const dialogActions = vi.hoisted(() => ({ openNewAgent: vi.fn() }));

vi.mock("../api/agents", () => ({ agentsApi }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));
vi.mock("../context/DialogContext", () => ({ useDialogActions: () => dialogActions }));
vi.mock("../lib/router", () => ({ Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => <a href={to} {...props}>{children}</a> }));

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Ada",
    urlKey: "ada",
    role: "engineer",
    title: null,
    icon: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

async function render() {
  await act(async () => {
    root.render(<QueryClientProvider client={queryClient}><CouncilAgentPanel /></QueryClientProvider>);
  });
}

async function waitFor(expectation: () => void) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      expectation();
      return;
    } catch (error) {
      if (attempt === 19) throw error;
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  agentsApi.list.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
});

describe("CouncilAgentPanel", () => {
  it("shows a loading state while agents are loading", async () => {
    let resolveAgents!: (agents: Agent[]) => void;
    agentsApi.list.mockReturnValue(new Promise<Agent[]>((resolve) => { resolveAgents = resolve; }));

    await render();
    expect(container.textContent).toContain("Loading agents…");

    await act(async () => resolveAgents([]));
    await waitFor(() => expect(container.textContent).toContain("No agents yet"));
  });

  it("lists company agents with friendly built-in adapter labels and Hermes badges", async () => {
    agentsApi.list.mockResolvedValue([
      makeAgent(),
      makeAgent({ id: "agent-2", name: "Hermes", urlKey: "hermes", role: "pm", adapterType: "hermes_gateway", status: "paused" }),
      makeAgent({ id: "agent-3", name: "Plugin", urlKey: "plugin", adapterType: "external_team_adapter" }),
    ]);

    await render();
    await waitFor(() => expect(container.textContent).toContain("Ada"));

    expect(agentsApi.list).toHaveBeenCalledWith("company-1");
    expect(container.textContent).toContain("Codex");
    expect(container.textContent).toContain("Hermes gateway");
    expect(container.textContent).toContain("Hermes");
    expect(container.textContent).toContain("external_team_adapter");
    expect(container.querySelector('a[href="/agents/ada"]')?.textContent).toBe("Ada");
    expect(container.textContent).toContain("paused");
  });

  it("opens the new agent dialog and explains the empty state", async () => {
    await render();
    await waitFor(() => expect(container.textContent).toContain("No agents yet"));

    expect(container.textContent).toContain("Agents are teammates that can later join war rooms.");
    expect(container.textContent).toContain("Coming soon: joining rooms.");
    await act(async () => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Create agent") as HTMLButtonElement).click());
    expect(dialogActions.openNewAgent).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable error when agents cannot load", async () => {
    agentsApi.list.mockRejectedValue(new Error("Unavailable"));
    await render();
    await waitFor(() => expect(container.textContent).toContain("Couldn’t load agents."));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t load agents.");
    agentsApi.list.mockResolvedValue([makeAgent()]);
    await act(async () => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Retry") as HTMLButtonElement).click());
    await waitFor(() => expect(container.textContent).toContain("Ada"));
  });

  it("refreshes after the company agents query is invalidated", async () => {
    agentsApi.list.mockResolvedValueOnce([]).mockResolvedValueOnce([makeAgent({ name: "Grace" })]);
    await render();
    await waitFor(() => expect(container.textContent).toContain("No agents yet"));

    await act(async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.agents.list("company-1") }); });
    await waitFor(() => expect(container.textContent).toContain("Grace"));
  });
});
