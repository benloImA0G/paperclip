export interface CouncilWorkStepView {
  n: number;
  title: string;
  expected: string;
  assignee: string;
  status: "pending" | "running" | "done" | "failed";
  error?: string;
}

const MARK: Record<CouncilWorkStepView["status"], string> = { pending: "○", running: "◔", done: "✓", failed: "✗" };
const TONE: Record<CouncilWorkStepView["status"], string> = {
  pending: "text-muted-foreground",
  running: "text-primary font-medium",
  done: "text-emerald-600",
  failed: "text-red-600",
};

/** The council's plan after agreement: numbered steps with who does each and live status. */
export function CouncilWorkPanel({ steps, running }: { steps: CouncilWorkStepView[]; running: boolean }) {
  if (!steps.length) return null;
  const done = steps.filter((s) => s.status === "done").length;
  return (
    <section aria-label="Council work plan" className="space-y-2 rounded-md border border-border/70 bg-card p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">Work plan</span>
        <span className="text-xs text-muted-foreground">{running ? "Working… " : ""}{done} of {steps.length} steps done</span>
      </div>
      <ol className="space-y-1.5">
        {steps.map((step) => (
          <li key={step.n} className="text-xs" aria-label={`Step ${step.n} ${step.status}`}>
            <span className={TONE[step.status]}>{MARK[step.status]} {step.n}. {step.title}</span>
            <span className="text-muted-foreground"> · {step.assignee}</span>
            <div className="pl-5 text-muted-foreground">Produces: {step.expected}</div>
            {step.error ? <div className="pl-5 text-red-600">{step.error}</div> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
