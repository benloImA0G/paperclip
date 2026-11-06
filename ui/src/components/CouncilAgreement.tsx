import type { CouncilAgreement } from "../api/council";

const TONE: Record<CouncilAgreement["label"], string> = {
  "Strong agreement": "bg-emerald-500",
  "Agreement with concessions": "bg-lime-500",
  Split: "bg-amber-500",
  "No agreement": "bg-red-500",
  "Not enough input": "bg-muted-foreground",
};

/** Plain-English agreement meter: label, percent, who agrees, concessions and open objections. */
export function CouncilAgreementMeter({ agreement, round }: { agreement: CouncilAgreement; round?: number }) {
  const { counts } = agreement;
  return (
    <section aria-label="Council agreement" className="space-y-2 rounded-md border border-border/70 bg-card p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{agreement.label}{round ? <span className="ml-2 text-xs font-normal text-muted-foreground">after discussion {round}</span> : null}</span>
        <span className="text-xs font-semibold" aria-label={`Agreement ${agreement.percent} percent`}>{agreement.percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        <div className={`h-full ${TONE[agreement.label]}`} style={{ width: `${Math.max(0, Math.min(100, agreement.percent))}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{agreement.plain}</p>
      <p className="text-xs">
        {counts.agree} agree · {counts.conditions} agree with conditions · {counts.disagree} disagree{counts.abstain ? ` · ${counts.abstain} abstain` : ""}
      </p>
      {agreement.concessions.length ? (
        <div>
          <p className="text-xs font-medium">Concessions</p>
          <ul className="list-disc pl-4 text-xs">{agreement.concessions.map((item, i) => <li key={`${item.seat}-${i}`}><strong>{item.seat}:</strong> {item.text}</li>)}</ul>
        </div>
      ) : null}
      {agreement.objections.length ? (
        <div>
          <p className="text-xs font-medium">Still open</p>
          <ul className="list-disc pl-4 text-xs">{agreement.objections.map((item, i) => <li key={`${item.seat}-${i}`}><strong>{item.seat}:</strong> {item.text}</li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}
