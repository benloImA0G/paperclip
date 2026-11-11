import { useEffect, useState } from "react";
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
  roomId?: string;
  decision: CouncilDecisionRecord;
  existingTasks?: Array<{ id: string; identifier: string | null; title: string; status: string; assigneeAgentId: string | null; assigneeUserId: string | null }>;
};

type RowState = { status: "idle" | "creating" | "done" | "error"; identifier?: string; message?: string; assigneeName?: string; issueStatus?: string };

const unavailableStatuses = new Set(["paused", "error", "terminated", "pending_approval"]);

export function ActionItemsChecklist({ companyId, roomIdentifier, decision, roomId, existingTasks = [] }: ActionItemsChecklistProps) {
  const items = decision.actionItems ?? [];
  const queryClient = useQueryClient();
  const agents = useQuery({ queryKey: queryKeys.agents.list(companyId), queryFn: () => agentsApi.list(companyId), enabled: Boolean(companyId) });
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [assignees, setAssignees] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [summary, setSummary] = useState<string | null>(null);
  useEffect(() => {
    if (!summary) return;
    const timer = window.setTimeout(() => setSummary(null), 8000);
    return () => window.clearTimeout(timer);
  }, [summary]);
  const assigneeFor = (index: number) => assignees[index] ?? (agents.data ?? []).find((agent) => agent.name === items[index]?.owner && !unavailableStatuses.has(agent.status))?.id ?? "";
  const create = useMutation({
    mutationFn: ({ item, index }: { item: CouncilActionItem; index: number }) => issuesApi.create(companyId, {
      title: item.text,
      description: actionItemDescription(item, decision, roomIdentifier),
      // Picking an agent hands the work over: "todo" lets the agent pick it up; unassigned items stay in the backlog.
      ...(assigneeFor(index) ? { assigneeAgentId: assigneeFor(index), status: "todo" } : {}),
    }),
  });
  if (items.length === 0) return null;

  async function createRow(index: number) {
    const item = items[index]!;
    const assigneeName = (agents.data ?? []).find((agent) => agent.id === assigneeFor(index))?.name;
    setRows((current) => ({ ...current, [index]: { status: "creating" } }));
    try {
      const issue = await create.mutateAsync({ item, index });
      setRows((current) => ({ ...current, [index]: { status: "done", identifier: issue.identifier ?? issue.id, assigneeName, issueStatus: issue.status } }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(roomIdentifier) });
      if (roomId && roomId !== roomIdentifier) void queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(roomId) });
      return true;
    } catch (error) {
      setRows((current) => ({ ...current, [index]: { status: "error", message: error instanceof Error ? error.message : "Couldn't create task" } }));
      return false;
    }
  }

  const linkedTask = (item: CouncilActionItem) => existingTasks.find((issue) => issue.title === item.text);
  const needsYou = (item: CouncilActionItem) => /\bben\b/i.test(item.owner ?? "") || /^(you|user|me)$/i.test(item.owner?.trim() ?? "");
  const pending = items
    .map((_, index) => index)
    .filter((index) => selected[index] && rows[index]?.status !== "done" && rows[index]?.status !== "creating" && !linkedTask(items[index]!) && !needsYou(items[index]!));

  return (
    <section aria-labelledby="council-action-items-title" className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="council-action-items-title" className="text-sm font-semibold">Action items</h3>
        <Button type="button" size="sm" variant="outline" disabled={pending.length === 0} onClick={() => { setSummary(null); void Promise.all(pending.map(createRow)).then((results) => { const count = results.filter(Boolean).length; setSummary(`Created ${count} ${count === 1 ? "task" : "tasks"}`); }); }}>
          Create selected{pending.length > 0 ? ` (${pending.length})` : ""}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Tick the actions you want and press Create selected, or press Create task on a single action. Nothing is created until you press one of them.</p>
      {summary ? <p role="status" className="text-xs text-muted-foreground">{summary}</p> : null}
      <ul className="space-y-2">
        {items.map((item, index) => {
          const state = rows[index] ?? { status: "idle" as const };
          const linked = linkedTask(item);
          const human = needsYou(item);
          const done = state.status === "done" || Boolean(linked);
          const identifier = linked?.identifier ?? linked?.id ?? state.identifier;
          const agentNames = new Map((agents.data ?? []).map((agent) => [agent.id, agent.name]));
          return (
            <li key={`${index}-${item.text}`} className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-center">
              <label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
                {!human ? <input type="checkbox" disabled={done} checked={done || Boolean(selected[index])} onChange={(event) => setSelected((current) => ({ ...current, [index]: event.target.checked }))} className="mt-1" /> : null}
                <span className="min-w-0">
                  <span className="block">{item.text}</span>
                  {item.owner ? <span className="block text-xs text-muted-foreground">Suggested owner: {item.owner}</span> : null}
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {human ? <span className="rounded-full bg-muted px-2 py-1 text-xs">Needs you</span> : done && identifier ? (
                  <Link to={`/issues/${identifier}`} className="text-xs text-muted-foreground underline">
                    {identifier} · {linked ? assigneeLabel(linked, agentNames) : state.assigneeName ?? "Unassigned"} · {linked?.status ?? state.issueStatus}
                  </Link>
                ) : (
                  <>
                    <NativeSelect aria-label={`Assignee for ${item.text}`} value={assigneeFor(index)} onChange={(event) => setAssignees((current) => ({ ...current, [index]: event.target.value }))}>
                      <option value="">Unassigned</option>
                      {(agents.data ?? []).map((agent) => <option key={agent.id} value={agent.id} disabled={unavailableStatuses.has(agent.status)}>{agent.name}{unavailableStatuses.has(agent.status) ? ` (${agent.status})` : ""}</option>)}
                    </NativeSelect>
                    <Button type="button" size="sm" disabled={state.status === "creating"} onClick={() => void createRow(index)}>
                      {state.status === "creating" ? "Creating…" : state.status === "error" ? "Retry" : "Create task"}
                    </Button>
                  </>
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

  if (!tasks.isError && linkedTasks.length === 0) return null;

  return (
    <details key={`${roomId}-${linkedTasks.some(({ issue }) => issue.status !== "done")}`} open={tasks.isError || linkedTasks.some(({ issue }) => issue.status !== "done")} className="space-y-2 rounded-lg border border-border p-2">
      <summary id="council-linked-tasks-title" className="cursor-pointer text-sm font-semibold">Tasks from this room ({linkedTasks.length})</summary>
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
    </details>
  );
}
