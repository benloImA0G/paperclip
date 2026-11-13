import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { agents, issueComments, issues, type Db } from "@paperclipai/db";
import { redactSensitiveText } from "../redaction.js";
import { issueReferenceService } from "./issue-references.js";

export const FOLLOWUP_EXCERPT_LENGTH = 240;
export const FOLLOWUP_STALE_DAYS = 3;

export type CouncilFollowUpTaskInput = {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  assigneeName: string | null;
  updatedAt: Date | string;
  latestComment: string | null;
};

export type CouncilFollowUpItem = {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  assigneeName: string | null;
  updatedAt: string;
  outcome: string | null;
  stale: boolean;
  staleDays: number;
};

export type CouncilFollowUp = {
  summary: { total: number; done: number; blocked: number; inProgress: number; open: number };
  headline: string;
  items: CouncilFollowUpItem[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function excerpt(body: string | null): string | null {
  if (!body) return null;
  const plain = redactSensitiveText(body)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;
  return plain.length > FOLLOWUP_EXCERPT_LENGTH ? `${plain.slice(0, FOLLOWUP_EXCERPT_LENGTH - 1).trimEnd()}…` : plain;
}

export function buildCouncilFollowUp(tasks: CouncilFollowUpTaskInput[], now: Date = new Date()): CouncilFollowUp {
  const summary = { total: tasks.length, done: 0, blocked: 0, inProgress: 0, open: 0 };
  const items = tasks.map((task): CouncilFollowUpItem => {
    const updated = new Date(task.updatedAt);
    const days = Math.max(0, Math.floor((now.getTime() - updated.getTime()) / DAY_MS));
    const isDone = task.status === "done";
    if (isDone) summary.done += 1;
    else if (task.status === "blocked") summary.blocked += 1;
    else if (task.status === "in_progress" || task.status === "in_review") summary.inProgress += 1;
    else if (task.status !== "cancelled") summary.open += 1;
    const stale = !isDone && task.status !== "cancelled" && days >= FOLLOWUP_STALE_DAYS;
    return {
      id: task.id,
      identifier: task.identifier,
      title: task.title,
      status: task.status,
      assigneeName: task.assigneeName,
      updatedAt: updated.toISOString(),
      outcome: excerpt(task.latestComment),
      stale,
      staleDays: days,
    };
  });
  let headline = "No tasks from this room yet";
  if (summary.total > 0) {
    const parts = [`${summary.done} of ${summary.total} done`];
    if (summary.blocked > 0) parts.push(`${summary.blocked} blocked`);
    if (summary.inProgress > 0) parts.push(`${summary.inProgress} in progress`);
    headline = parts.join(", ");
  }
  return { summary, headline, items };
}

/** Loads the room's linked tasks via the same reference path as the Linked tasks panel, then adds assignee names and latest comments. */
export async function loadCouncilFollowUp(db: Db, companyId: string, roomId: string): Promise<CouncilFollowUp> {
  const related = await issueReferenceService(db).listIssueReferenceSummary(roomId);
  const linked = related.inbound.map(({ issue }) => issue);
  if (linked.length === 0) return buildCouncilFollowUp([]);
  const ids = linked.map((issue) => issue.id);
  const agentIds = [...new Set(linked.map((issue) => issue.assigneeAgentId).filter((id): id is string => Boolean(id)))];
  const [agentRows, commentRows] = await Promise.all([
    agentIds.length > 0
      ? db.select({ id: agents.id, name: agents.name }).from(agents).where(and(eq(agents.companyId, companyId), inArray(agents.id, agentIds)))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    db
      .select({ issueId: issueComments.issueId, body: issueComments.body, createdAt: issueComments.createdAt })
      .from(issueComments)
      .where(and(eq(issueComments.companyId, companyId), inArray(issueComments.issueId, ids), isNull(issueComments.deletedAt)))
      .orderBy(desc(issueComments.createdAt)),
  ]);
  const names = new Map(agentRows.map((row) => [row.id, row.name]));
  const latest = new Map<string, string>();
  for (const row of commentRows) if (!latest.has(row.issueId)) latest.set(row.issueId, row.body);
  const updatedRows = await db.select({ id: issues.id, updatedAt: issues.updatedAt }).from(issues).where(and(eq(issues.companyId, companyId), inArray(issues.id, ids)));
  const updatedAt = new Map(updatedRows.map((row) => [row.id, row.updatedAt]));
  return buildCouncilFollowUp(linked.map((issue) => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    status: issue.status,
    assigneeName: issue.assigneeAgentId ? names.get(issue.assigneeAgentId) ?? "Agent" : issue.assigneeUserId ? "A person" : null,
    updatedAt: updatedAt.get(issue.id) ?? new Date(),
    latestComment: latest.get(issue.id) ?? null,
  })));
}
