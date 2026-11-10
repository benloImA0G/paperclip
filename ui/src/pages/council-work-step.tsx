import { useEffect, useRef, useState } from "react";
import type { CouncilWorkState, WorkStep } from "../api/council";

const MARK: Record<WorkStep["status"], string> = { pending: "○", running: "◔", done: "✓", failed: "✗" };
const TONE: Record<WorkStep["status"], string> = {
  pending: "text-muted-foreground", running: "text-primary font-medium", done: "text-foreground", failed: "text-destructive",
};

/** Remove unmatched trailing HTML tags without disturbing balanced markup in the summary. */
export function stripTrailingUnbalancedTags(text: string): string {
  const stack: Array<{ tag: string; index: number }> = [];
  const tags = /<\/?([a-z][\w-]*)\b[^>]*>/gi;
  const unmatched = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = tags.exec(text))) {
    const tag = match[1].toLowerCase();
    if (/^<\//.test(match[0])) {
      if (stack[stack.length - 1]?.tag === tag) stack.pop();
      else unmatched.add(match.index);
    } else if (!/\/>$/.test(match[0]) && !["br", "hr", "img", "input", "meta", "link"].includes(tag)) {
      stack.push({ tag, index: match.index });
    }
  }
  for (const open of stack) unmatched.add(open.index);
  return text.replace(/(?:\s*<\/?[a-z][\w-]*\b[^>]*>\s*)+$/i, (tail, offset: number) => {
    let result = tail;
    const trailing = [...tail.matchAll(/<\/?[a-z][\w-]*\b[^>]*>/gi)];
    for (let i = trailing.length - 1; i >= 0; i--) {
      const tag = trailing[i];
      if (!unmatched.has(offset + tag.index!)) break;
      result = result.slice(0, tag.index).trimEnd();
    }
    return result;
  });
}

export function CouncilWorkStep({ step }: { step: WorkStep }) {
  const rejected = step.grade === "fail";
  const reason = step.gradeNote?.replace(/\s+/g, " ").trim().slice(0, 160);
  return (
    <li className="text-xs" aria-label={`Step ${step.n} ${step.status}`}>
      <span className={rejected ? "text-destructive" : TONE[step.status]}>{rejected ? "✗" : MARK[step.status]} {step.n}. {step.title}</span>
      <span className="text-muted-foreground"> · {step.assignee}</span>
      <div className="pl-5 text-muted-foreground">Produces: {step.expected}</div>
      {step.grade || step.attempts === 2 || step.after?.length ? (
        <div className="pl-5 text-muted-foreground">
          {step.grade ? <span title={step.gradeNote}>checked: {step.grade}</span> : null}
          {step.grade && (step.attempts === 2 || step.after?.length) ? " · " : null}
          {step.attempts === 2 ? "retried" : null}
          {step.attempts === 2 && step.after?.length ? " · " : null}
          {step.after?.map((n, index) => <span key={`${n}-${index}`}>{index ? ", " : ""}waits for step {n}</span>)}
        </div>
      ) : null}
      {rejected && reason ? <div className="pl-5 text-destructive">The checker said: {reason}</div> : null}
      {rejected ? <div className="pl-5 text-muted-foreground">You can ask again, or start the work again with a clearer goal.</div> : null}
      {step.error ? <div className="pl-5 text-destructive">{step.error}</div> : null}
    </li>
  );
}

export function CouncilWorkPanel({ steps, running, summary, status }: { steps: WorkStep[]; running: boolean; summary?: string | null; status?: CouncilWorkState["status"] }) {
  const started = useRef<number | null>(running ? Date.now() : null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    started.current = Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - started.current!) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const automaticSummary = summary?.startsWith("## Work summary (automatic)");
  if (!steps.length && !summary) return null;
  // A finished step without a checker verdict (checks switched off) counts as passed; only an explicit fail does not.
  const passed = steps.filter((step) => step.status === "done" && step.grade !== "fail").length;
  const problems = status === "partial" || status === "failed" || status === "cancelled" || steps.some((step) => step.status === "failed" || step.grade === "fail") || (!running && passed < steps.length);
  const current = steps.find((step) => step.status === "running")?.n ?? Math.min(passed + 1, steps.length);
  const duration = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`;
  const message = running ? `Working: step ${current} of ${steps.length}… (${elapsed}s)` : problems
    ? `Finished with problems: ${passed} passed, ${steps.length - passed} did not pass the check. Review the red steps before using the result.`
    : `Finished: all ${steps.length} steps passed the check${started.current !== null ? ` (took ${duration})` : ""}`;
  return (
    <section aria-label="Council work plan" className="space-y-2 rounded-md border border-border/70 bg-card p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">Work plan</span>
        <span className={problems && !running ? "text-xs" : "text-xs text-muted-foreground"} style={problems && !running ? { color: "var(--status-task-icon-todo)" } : undefined}>{message}</span>
      </div>
      {automaticSummary ? <p className="text-xs text-muted-foreground">The chair could not write the summary; this list was generated from the steps.</p> : null}
      <ol className="space-y-1.5">{steps.map((step) => <CouncilWorkStep key={step.n} step={step} />)}</ol>
      {summary ? <div className="whitespace-pre-wrap text-xs">{stripTrailingUnbalancedTags(summary)}</div> : null}
    </section>
  );
}
