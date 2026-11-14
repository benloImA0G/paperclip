import { redactSensitiveText } from "../redaction.js";

export type CouncilTaskResultStatus = "done" | "failed" | "blocked" | "cancelled";

export type CouncilTaskResultInput = {
  taskId: string;
  title: string;
  status: CouncilTaskResultStatus;
  ownerName?: string | null;
  resultText?: string | null;
  finishedAt: Date | string;
};

const nextSteps: Record<CouncilTaskResultStatus, string> = {
  done: "Review the result",
  failed: "Ask the council to retry or change the plan",
  blocked: "Something needs your decision",
  cancelled: "No action needed",
};

function safeLines(text: string): string {
  return text.split(/\r?\n/).filter((line) =>
    redactSensitiveText(line) === line && !/\bsk-\S+|\bBearer\s+\S+|\btoken\s*=\s*\S+/i.test(line),
  ).join("\n").trim();
}

function resultExcerpt(text: string): string {
  if (text.length <= 600) return text;
  const prefix = text.slice(0, 599);
  const boundary = prefix.search(/\s+\S*$/);
  return `${(boundary > 0 ? prefix.slice(0, boundary) : prefix).trimEnd()}…`;
}

export function buildResultCard(task: CouncilTaskResultInput) {
  const title = safeLines(task.title).replace(/\s+/g, " ") || "Task";
  const owner = task.ownerName ? safeLines(task.ownerName).replace(/\s+/g, " ") : "";
  const result = task.resultText ? resultExcerpt(safeLines(task.resultText)) : "";
  const markdown = [
    `**${task.status.toUpperCase()}: ${title}**`,
    `Owner: ${owner || "Unassigned"}`,
    result ? `Result: ${result}` : "Result: No result provided.",
    `What to do next: ${nextSteps[task.status]}`,
  ].join("\n\n");
  return { kind: "council_task_result" as const, markdown, status: task.status, taskId: task.taskId };
}

export function shouldPostCard(previousStatus: string | null | undefined, nextStatus: string): boolean {
  return previousStatus !== nextStatus && Object.hasOwn(nextSteps, nextStatus);
}
