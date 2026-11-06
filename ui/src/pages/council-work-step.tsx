import type { WorkStep } from "../api/council";

const MARK: Record<WorkStep["status"], string> = { pending: "○", running: "◔", done: "✓", failed: "✗" };
const TONE: Record<WorkStep["status"], string> = {
  pending: "text-muted-foreground",
  running: "text-primary font-medium",
  done: "text-foreground",
  failed: "text-destructive",
};

export function CouncilWorkStep({ step }: { step: WorkStep }) {
  return (
    <li className="text-xs" aria-label={`Step ${step.n} ${step.status}`}>
      <span className={TONE[step.status]}>{MARK[step.status]} {step.n}. {step.title}</span>
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
      {step.error ? <div className="pl-5 text-destructive">{step.error}</div> : null}
    </li>
  );
}

export function CouncilWorkPanel({ steps, running, summary }: { steps: WorkStep[]; running: boolean; summary?: string | null }) {
  const automaticSummary = summary?.startsWith("## Work summary (automatic)");
  if (!steps.length && !automaticSummary) return null;
  const done = steps.filter((step) => step.status === "done").length;
  return (
    <section aria-label="Council work plan" className="space-y-2 rounded-md border border-border/70 bg-card p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">Work plan</span>
        <span className="text-xs text-muted-foreground">{running ? "Working… " : ""}{done} of {steps.length} steps done</span>
      </div>
      {automaticSummary ? <p className="text-xs text-muted-foreground">The chair could not write the summary; this list was generated from the steps.</p> : null}
      <ol className="space-y-1.5">{steps.map((step) => <CouncilWorkStep key={step.n} step={step} />)}</ol>
    </section>
  );
}
