// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionItemsChecklist, CreateTaskFromDecisionButton, LinkedTasksPanel } from "./CouncilTaskBridge";
import type { CouncilDecisionRecord } from "../pages/council-decision-record";

const mocks = vi.hoisted(() => ({
  openNewIssue: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  listAgents: vi.fn(),
}));

vi.mock("../context/DialogContext", () => ({
  useDialogActions: () => ({ openNewIssue: mocks.openNewIssue }),
}));

vi.mock("../api/issues", () => ({
  issuesApi: { get: mocks.get, create: mocks.create },
}));

vi.mock("../api/agents", () => ({
  agentsApi: { list: mocks.listAgents },
}));

vi.mock("../lib/router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a>,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  // react-query resolves queries across several macrotask ticks; one tick is not always enough under load.
  await act(async () => {
    for (let tick = 0; tick < 5; tick += 1) {
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  });
}

describe("CouncilTaskBridge", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mocks.openNewIssue.mockReset();
    mocks.get.mockReset();
    mocks.create.mockReset();
    mocks.listAgents.mockReset();
    mocks.listAgents.mockResolvedValue([{ id: "agent-1", name: "Researcher" }]);
  });

  afterEach(() => container.remove());

  it("opens a normal task with decision context and a room reference", () => {
    const root = createRoot(container);
    act(() => {
      root.render(
        <CreateTaskFromDecisionButton
          roomId="room-1"
          roomIdentifier="PAP-41"
          roomTitle="Pricing review"
          decision={{ recommendation: "Adopt annual pricing", confidence: "High", agreement: [], dissent: [], risks: ["Churn risk"], nextQuestion: "Who owns launch?", actionItems: [] }}
        />,
      );
    });

    (container.querySelector("button") as HTMLButtonElement).click();
    expect(mocks.openNewIssue).toHaveBeenCalledWith({
      title: "Adopt annual pricing",
      description: "## Recommendation\n\nAdopt annual pricing\n\n## Risks and unknowns\n\n- Churn risk\n\n## Next question\n\nWho owns launch?\n\n[PAP-41](/issues/PAP-41)",
    });
    act(() => root.unmount());
  });

  it("lists inbound tasks from the room detail", async () => {
    mocks.get.mockResolvedValue({
      relatedWork: {
        inbound: [{ issue: { id: "task-1", identifier: "PAP-42", title: "Prepare pricing launch", status: "todo", priority: "medium", assigneeAgentId: "agent-1", assigneeUserId: null }, mentionCount: 1, sources: [] }],
        outbound: [],
      },
    });
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(<QueryClientProvider client={client}><LinkedTasksPanel roomId="room-1" /></QueryClientProvider>);
    });
    await flush();

    expect(container.querySelector("summary")?.textContent).toBe("Tasks from this room (1)");
    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.textContent).toContain("PAP-42");
    expect(container.textContent).toContain("Prepare pricing launch");
    expect(container.textContent).toContain("Agent agent-1");
    expect(container.querySelector('a[href="/issues/PAP-42"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it("shows an empty state when no task references the room", async () => {
    mocks.get.mockResolvedValue({ relatedWork: { inbound: [], outbound: [] } });
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(<QueryClientProvider client={client}><LinkedTasksPanel roomId="room-1" /></QueryClientProvider>);
    });
    await flush();

    expect(container.textContent).toBe("");
    act(() => root.unmount());
  });

  it("keeps a retry action visible when linked tasks cannot load", async () => {
    mocks.get.mockRejectedValue(new Error("Network unavailable"));
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(<QueryClientProvider client={client}><LinkedTasksPanel roomId="room-1" /></QueryClientProvider>);
    });
    await flush();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load linked tasks.");
    expect(container.querySelector("button")?.textContent).toBe("Retry");
    act(() => root.unmount());
  });

  it("shows the agent name for linked tasks when companyId is provided", async () => {
    mocks.get.mockResolvedValue({
      relatedWork: {
        inbound: [{ issue: { id: "task-1", identifier: "PAP-42", title: "Prepare pricing launch", status: "todo", priority: "medium", assigneeAgentId: "agent-1", assigneeUserId: null }, mentionCount: 1, sources: [] }],
        outbound: [],
      },
    });
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(<QueryClientProvider client={client}><LinkedTasksPanel roomId="room-1" companyId="company-1" /></QueryClientProvider>);
    });
    await flush();

    expect(container.textContent).toContain("Researcher");
    expect(container.textContent).not.toContain("Agent agent-1");
    act(() => root.unmount());
  });

  it("asks in the room about a linked task", async () => {
    mocks.get.mockResolvedValue({
      relatedWork: {
        inbound: [{ issue: { id: "task-1", identifier: "PAP-42", title: "Prepare pricing launch", status: "todo", priority: "medium", assigneeAgentId: "agent-1", assigneeUserId: null }, mentionCount: 1, sources: [] }],
        outbound: [],
      },
    });
    const onAskInRoom = vi.fn();
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(<QueryClientProvider client={client}><LinkedTasksPanel roomId="room-1" onAskInRoom={onAskInRoom} /></QueryClientProvider>);
    });
    await flush();

    act(() => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Ask in room") as HTMLButtonElement).click());
    expect(onAskInRoom).toHaveBeenCalledWith("Follow up on PAP-42: Prepare pricing launch (status: todo). What is the latest and what is next?");
    act(() => root.unmount());
  });

  describe("ActionItemsChecklist", () => {
    const decision: CouncilDecisionRecord = {
      recommendation: "Adopt annual pricing",
      confidence: "High",
      agreement: [],
      dissent: [],
      risks: [],
      nextQuestion: "Who owns launch?",
      actionItems: [{ text: "Draft pricing memo" }],
    };

    function renderChecklist(existingTasks?: Array<{ id: string; identifier: string | null; title: string; status: string; assigneeAgentId: string | null; assigneeUserId: string | null }>, record = decision) {
      const root = createRoot(container);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      act(() => {
        root.render(
          <QueryClientProvider client={client}>
            <ActionItemsChecklist companyId="company-1" roomIdentifier="PAP-41" decision={record} existingTasks={existingTasks} />
          </QueryClientProvider>,
        );
      });
      return root;
    }

    function rowFor(text: string) {
      return Array.from(container.querySelectorAll("li")).find((li) => li.textContent?.includes(text)) ?? null;
    }

    it("creates a task for a row with the selected assignee and then shows the identifier link", async () => {
      mocks.create.mockResolvedValue({ id: "issue-43", identifier: "PAP-43", status: "todo" });
      const root = renderChecklist();
      await flush();
      expect(container.textContent).toContain("Tick the actions you want and press Create selected, or press Create task on a single action. Nothing is created until you press one of them.");

      const select = container.querySelector('[aria-label="Assignee for Draft pricing memo"]') as HTMLSelectElement;
      act(() => {
        select.value = "agent-1";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });

      const button = rowFor("Draft pricing memo")?.querySelector("button") as HTMLButtonElement;
      expect(button.textContent).toBe("Create task");
      act(() => button.click());
      await flush();

      expect(mocks.create).toHaveBeenCalledTimes(1);
      expect(mocks.create).toHaveBeenCalledWith(
        "company-1",
        expect.objectContaining({
          title: "Draft pricing memo",
          description: expect.stringContaining("[PAP-41](/issues/PAP-41)"),
          assigneeAgentId: "agent-1",
          status: "todo",
        }),
      );
      const row = rowFor("Draft pricing memo");
      expect(row?.querySelector('a[href="/issues/PAP-43"]')?.textContent).toBe("PAP-43 · Researcher · todo");
      expect(row?.querySelector("select")).toBeNull();
      expect(row?.querySelector("button")).toBeNull();
      act(() => root.unmount());
    });

    it("labels and disables unavailable agents and preselects a healthy matching seat", async () => {
      mocks.listAgents.mockResolvedValue([
        ...["active", "idle", "running", "paused", "error", "terminated", "pending_approval"].map((status) => ({ id: status, name: status, status })),
        { id: "owner", name: "CodeBot", status: "idle" },
      ]);
      const root = renderChecklist(undefined, { ...decision, actionItems: [{ text: "Draft pricing memo", owner: "CodeBot" }] });
      await flush();
      const select = container.querySelector("select") as HTMLSelectElement;
      expect(select.value).toBe("owner");
      expect(container.textContent).toContain("Suggested owner: CodeBot");
      for (const status of ["active", "idle", "running"]) expect((select.querySelector(`option[value="${status}"]`) as HTMLOptionElement).disabled).toBe(false);
      for (const status of ["paused", "error", "terminated", "pending_approval"]) {
        const option = select.querySelector(`option[value="${status}"]`) as HTMLOptionElement;
        expect(option.disabled).toBe(true);
        expect(option.textContent).toBe(`${status} (${status})`);
      }
      act(() => root.unmount());
    });

    it("does not preselect an unavailable matching agent and confirms backlog creation", async () => {
      mocks.listAgents.mockResolvedValue([{ id: "owner", name: "CodeBot", status: "paused" }]);
      mocks.create.mockResolvedValue({ id: "issue-43", identifier: "PAP-43", status: "backlog" });
      const root = renderChecklist(undefined, { ...decision, actionItems: [{ text: "Draft pricing memo", owner: "CodeBot" }] });
      await flush();
      expect((container.querySelector("select") as HTMLSelectElement).value).toBe("");
      act(() => (rowFor("Draft pricing memo")?.querySelector("button") as HTMLButtonElement).click());
      await flush();
      expect(mocks.create.mock.calls[0]![1]).not.toHaveProperty("assigneeAgentId");
      expect(rowFor("Draft pricing memo")?.textContent).toContain("PAP-43 · Unassigned · backlog");
      act(() => root.unmount());
    });

    it("summarizes tasks created in a batch", async () => {
      mocks.create.mockResolvedValue({ id: "issue-43", identifier: "PAP-43", status: "backlog" });
      const root = renderChecklist(undefined, { ...decision, actionItems: [{ text: "First" }, { text: "Second" }, { text: "Third" }] });
      await flush();
      act(() => container.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => (checkbox as HTMLInputElement).click()));
      act(() => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.startsWith("Create selected")) as HTMLButtonElement).click());
      await flush();
      expect(container.querySelector('[role="status"]')?.textContent).toBe("Created 3 tasks");
      act(() => root.unmount());
    });

    it("keeps human-owned items for the user without task controls", async () => {
      const root = renderChecklist(undefined, { ...decision, actionItems: ["Ben", "Ask Ben later", "you", "USER", "me"].map((owner) => ({ text: `Question for ${owner}`, owner })) });
      await flush();
      expect(container.querySelectorAll("li")).toHaveLength(5);
      expect(container.querySelectorAll("li input, li select, li button")).toHaveLength(0);
      expect(container.textContent?.match(/Needs you/g)).toHaveLength(5);
      act(() => root.unmount());
    });

    it("clears the batch summary after eight seconds", async () => {
      mocks.create.mockResolvedValue({ id: "issue-43", identifier: "PAP-43", status: "backlog" });
      const root = renderChecklist();
      await flush();
      act(() => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
      act(() => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.startsWith("Create selected")) as HTMLButtonElement).click());
      await flush();
      expect(container.textContent).toContain("Created 1 task");
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 8100)); });
      expect(container.textContent).not.toContain("Created 1 task");
      act(() => root.unmount());
    }, 12000);

    it("shows an alert and a Retry button when creating a task fails", async () => {
      mocks.create.mockRejectedValue(new Error("Network down"));
      const root = renderChecklist();
      await flush();

      const button = rowFor("Draft pricing memo")?.querySelector("button") as HTMLButtonElement;
      act(() => button.click());
      await flush();

      expect(container.querySelector('[role="alert"]')?.textContent).toContain("Network down");
      expect(rowFor("Draft pricing memo")?.querySelector("button")?.textContent).toBe("Retry");
      act(() => root.unmount());
    });

    it("shows 'Task exists' and no create button for items already linked to the room", async () => {
      const root = renderChecklist([{ id: "issue-43", identifier: "PAP-43", title: "Draft pricing memo", status: "backlog", assigneeAgentId: "agent-1", assigneeUserId: null }]);
      await flush();

      const row = rowFor("Draft pricing memo");
      expect(row?.querySelector("a")?.textContent).toBe("PAP-43 · Researcher · backlog");
      expect(row?.querySelector("select")).toBeNull();
      expect(row?.querySelector("button")).toBeNull();
      act(() => root.unmount());
    });
  });
});
