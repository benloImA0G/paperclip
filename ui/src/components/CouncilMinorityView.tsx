import type { CouncilMinorityItem } from "../api/council";

const REASON_LABEL: Record<CouncilMinorityItem["reason"], string> = {
  ranked_low_but_disagrees: "Ranked low, still disagrees",
  dissent_flagged: "Dissent flagged",
  different_conclusion: "Different conclusion",
};

export function CouncilMinorityView({ items, uncovered = [] }: { items: CouncilMinorityItem[]; uncovered?: string[] }) {
  if (items.length === 0) return null;
  return (
    <details aria-label="Minority view" className="rounded-md border border-border p-2 text-sm">
      <summary className="cursor-pointer text-xs font-medium">Minority view ({items.length})</summary>
      <ul className="mt-2 space-y-2">
        {items.map((item, index) => (
          <li key={`${item.seat}-${index}`} className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-medium">{item.seat}</span>
              <span className="rounded-full bg-muted px-2 py-1 text-xs">{REASON_LABEL[item.reason]}</span>
              {uncovered.includes(item.seat) ? <span className="text-xs text-destructive">Not in the summary</span> : null}
            </div>
            <p className="text-xs text-muted-foreground">{item.view}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
