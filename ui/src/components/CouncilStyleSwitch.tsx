export type CouncilQuickStyle = "collaborate" | "challenge" | "chain";

const options: { value: CouncilQuickStyle; label: string }[] = [
  { value: "collaborate", label: "Work together" },
  { value: "challenge", label: "Challenge each other" },
  { value: "chain", label: "One after another" },
];

export function CouncilStyleSwitch({ value, onChange }: { value: CouncilQuickStyle; onChange: (value: CouncilQuickStyle) => void }) {
  const hints = { collaborate: "Seats answer side by side.", challenge: "Seats answer, then challenge each other for 1 round.", chain: "Each seat sees the previous answer and improves it." };
  return <div><div role="group" aria-label="How the council answers" className="flex flex-wrap gap-1 rounded-md border p-1">
    {options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)} className={value === option.value ? "rounded-sm bg-primary px-2 py-1 text-xs font-bold text-primary-foreground" : "rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-muted"}>{option.label}</button>)}
  </div><p className="text-xs text-muted-foreground">{hints[value]}</p></div>;
}
