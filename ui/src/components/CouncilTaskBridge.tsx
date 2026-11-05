import { useQuery } from "@tanstack/react-query";
import type { CouncilDecisionRecord } from "../pages/council-decision-record";
import { issuesApi } from "../api/issues";
import { useDialogActions } from "../context/DialogContext";
import { queryKeys } from "../lib/queryKeys";
import { Link } from "../lib/router";
import { Button } from "./ui/button";
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

function assigneeLabel(issue: { assigneeAgentId: string | null; assigneeUserId: string | null }) {
  if (issue.assigneeAgentId) return `Agent ${issue.assigneeAgentId}`;
  if (issue.assigneeUserId) return `User ${issue.assigneeUserId}`;
  return "Unassigned";
}

export function LinkedTasksPanel({ roomId }: { roomId: string }) {
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
                <span>{assigneeLabel(issue)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
