// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateTaskFromDecisionButton, LinkedTasksPanel } from "./CouncilTaskBridge";

const mocks = vi.hoisted(() => ({
  openNewIssue: vi.fn(),
  get: vi.fn(),
}));

vi.mock("../context/DialogContext", () => ({
  useDialogActions: () => ({ openNewIssue: mocks.openNewIssue }),
}));

vi.mock("../api/issues", () => ({
  issuesApi: { get: mocks.get },
}));

vi.mock("../lib/router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a>,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("CouncilTaskBridge", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mocks.openNewIssue.mockReset();
    mocks.get.mockReset();
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
          decision={{ recommendation: "Adopt annual pricing", confidence: "High", agreement: [], dissent: [], risks: ["Churn risk"], nextQuestion: "Who owns launch?" }}
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

    expect(container.textContent).toContain("No tasks yet");
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
});
