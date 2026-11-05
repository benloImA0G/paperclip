import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CouncilActionItem, CouncilDecisionRecord } from "../pages/council-decision-record";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { useDialogActions } from "../context/DialogContext";
import { queryKeys } from "../lib/queryKeys";
import { Link } from "../lib/router";
import { Button } from "./ui/button";
import { NativeSelect } from "./ui/select";
import { IssueStatusBadge } from "./StatusBadge";

export type CreateTaskFromDecisionButtonProps = {
  roomId: string;
  roomIdentifier: string;
  roomTitle: string;
  decision: CouncilDecisionRecord;
};

function decisionTaskDescription(decision: CouncilDecisionRecord, roomIdentifier: string) {
  const risks = decision.risks.length > 0
    ? decision.risks.map((risk) => `- ${risk}`).join("\n")
    : "- No risks recorded.";
  return [
    "## Recommendation",
    decision.recommendation,
    "## Risks and unknowns",
    risks,
    "## Next question",
    decision.nextQuestion,
    `[${roomIdentifier}](/issues/${roomIdentifier})`,
  ].join("\n\n");
}

export function CreateTaskFromDecisionButton({ roomId, roomIdentifier, roomTitle, decision }: CreateTaskFromDecisionButtonProps) {
  const { openNewIssue } = useDialogActions();

  return (
    <Button
      type="button"
      size="sm"
      onClick={() => openNewIssue({
        title: decision.recommendation,
        description: decisionTaskDescription(decision, roomIdentifier),
      })}
      aria-label={`Create task from the decision in ${roomTitle}`}
      data-council-room-id={roomId}
    >
      Create task
    </Button>
  );
}

function assigneeLabel(issue: { assigneeAgentId: string | null; assigneeUserId: string | null }, agentNames?: Map<string, string>) {
  if (issue.assigneeAgentId) return agentNames?.get(issue.assigneeAgentId) ?? `Agent ${issue.assigneeAgentId}`;
  if (issue.assigneeUserId) return `User ${issue.assigneeUserId}`;
  return "Unassigned";
}

function actionItemDescription(item: CouncilActionItem, decision: CouncilDecisionRecord, roomIdentifier: string) {
  return [
    item.text,
    `## Why (council recommendation)\n\n${decision.recommendation}`,
    item.owner ? `Suggested owner: ${item.owner}` : null,
    `[${roomIdentifier}](/issues/${roomIdentifier})`,
  ].filter(Boolean).join("\n\n");
}

export type ActionItemsChecklistProps = {
  companyId: string;
  roomIdentifier: string;
  decision: CouncilDecisionRecord;
  /** Titles of tasks already linked to the room, so a reload does not allow double-creating. */
  existingTitles?: string[];
};

type RowState = { status: "idle" | "creating" | "done" | "error"; identifier?: string; message?: string };

export function ActionItemsChecklist({ companyId, roomIdentifier, decision, existingTitles = [] }: ActionItemsChecklistProps) {
  const items = decision.actionItems ?? [];
  const queryClient = useQueryClient();
  const agents = useQuery({ queryKey: queryKeys.agents.list(companyId), queryFn: () => agentsApi.list(companyId), enabled: Boolean(companyId) });
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [assignees, setAssignees] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const create = useMutation({
    mutationFn: ({ item, index }: { item: CouncilActionItem; index: number }) => issuesApi.create(companyId, {
      title: item.text,
      description: actionItemDescription(item, decision, roomIdentifier),
      ...(assignees[index] ? { assigneeAgentId: assignees[index] } : {}),
    }),
  });
  if (items.length === 0) return null;

  async function createRow(index: number) {
    const item = items[index]!;
    setRows((current) => ({ ...current, [index]: { status: "creating" } }));
    try {
      const issue = await create.mutateAsync({ item, index });
      setRows((current) => ({ ...current, [index]: { status: "done", identifier: issue.identifier ?? issue.id } }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(roomIdentifier) });
    } catch (error) {
      setRows((current) => ({ ...current, [index]: { status: "error", message: error instanceof Error ? error.message : "Couldn't create task" } }));
    }
  }

  const alreadyLinked = (item: CouncilActionItem) => existingTitles.includes(item.text);
  const pending = items
    .map((_, index) => index)
    .filter((index) => selected[index] && rows[index]?.status !== "done" && rows[index]?.status !== "creating" && !alreadyLinked(items[index]!));

  return (
    <section aria-labelledby="council-action-items-title" className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="council-action-items-title" className="text-sm font-semibold">Action items</h3>
        <Button type="button" size="sm" variant="outline" disabled={pending.length === 0} onClick={() => { for (const index of pending) void createRow(index); }}>
          Create selected{pending.length > 0 ? ` (${pending.length})` : ""}
        </Button>
      </div>
      <ul className="space-y-2">
        {items.map((item, index) => {
          const state = rows[index] ?? { status: "idle" as const };
          const done = state.status === "done" || alreadyLinked(item);
          return (
            <li key={`${index}-${item.text}`} className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-center">
              <label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
                <input type="checkbox" disabled={done} checked={done || Boolean(selected[index])} onChange={(event) => setSelected((current) => ({ ...current, [index]: event.target.checked }))} className="mt-1" />
                <span className="min-w-0">
                  <span className="block">{item.text}</span>
                  {item.owner ? <span className="block text-xs text-muted-foreground">Suggested owner: {item.owner}</span> : null}
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <NativeSelect aria-label={`Assignee for ${item.text}`} disabled={done} value={assignees[index] ?? ""} onChange={(event) => setAssignees((current) => ({ ...current, [index]: event.target.value }))}>
                  <option value="">Unassigned</option>
                  {(agents.data ?? []).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </NativeSelect>
                {done ? (
                  <span className="text-xs text-muted-foreground">
                    {state.identifier ? <Link to={`/issues/${state.identifier}`} className="underline">{state.identifier}</Link> : "Task exists"}
                  </span>
                ) : (
                  <Button type="button" size="sm" disabled={state.status === "creating"} onClick={() => void createRow(index)}>
                    {state.status === "creating" ? "Creating…" : state.status === "error" ? "Retry" : "Create task"}
                  </Button>
                )}
              </div>
              {state.status === "error" ? <p role="alert" className="text-xs text-destructive">{state.message}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function LinkedTasksPanel({ roomId, companyId, onAskInRoom }: { roomId: string; companyId?: string; onAskInRoom?: (text: string) => void }) {
  const agents = useQuery({
    queryKey: queryKeys.agents.list(companyId ?? ""),
    queryFn: () => agentsApi.list(companyId ?? ""),
    enabled: Boolean(companyId),
  });
  const agentNames = new Map((agents.data ?? []).map((agent) => [agent.id, agent.name]));
  const tasks = useQuery({
    queryKey: queryKeys.issues.detail(roomId),
    queryFn: () => issuesApi.get(roomId),
    enabled: Boolean(roomId),
  });
  const linkedTasks = tasks.data?.relatedWork?.inbound ?? [];

  return (
    <section aria-labelledby="council-linked-tasks-title" className="space-y-2 rounded-lg border border-border p-3">
      <h2 id="council-linked-tasks-title" className="text-sm font-semibold">Linked tasks</h2>
      {tasks.isLoading ? <p role="status" className="text-xs text-muted-foreground">Loading tasks…</p> : null}
      {tasks.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Couldn&apos;t load linked tasks.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void tasks.refetch()}>Retry</Button>
        </div>
      ) : null}
      {!tasks.isLoading && !tasks.isError && linkedTasks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No tasks yet</p>
      ) : null}
      {!tasks.isLoading && !tasks.isError && linkedTasks.length > 0 ? (
        <ul className="space-y-2">
          {linkedTasks.map(({ issue }) => (
            <li key={issue.id} className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-center">
              <Link
                to={`/issues/${issue.identifier ?? issue.id}`}
                className="min-w-0 flex-1 text-sm hover:underline"
                aria-label={`Open task ${issue.identifier ?? issue.title}`}
              >
                <span className="block truncate font-medium">{issue.identifier ?? issue.id}</span>
                <span className="block truncate text-muted-foreground">{issue.title}</span>
              </Link>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <IssueStatusBadge status={issue.status} displayStatus={issue.displayStatus} />
                <span>{assigneeLabel(issue, agentNames)}</span>
                {onAskInRoom ? <Button type="button" variant="outline" size="sm" onClick={() => onAskInRoom(`Follow up on ${issue.identifier ?? issue.id}: ${issue.title} (status: ${issue.status}). What is the latest and what is next?`)}>Ask in room</Button> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
