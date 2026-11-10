import type { ReactNode } from "react";

export function CouncilSetting({ description, children }: { description: string; children: ReactNode }) {
  return <div className="space-y-1">{children}<p className="text-xs text-muted-foreground">{description}</p></div>;
}

export function CouncilSettingsPanel({ who, how, extras }: { who: ReactNode; how: ReactNode; extras: ReactNode }) {
  return <div className="space-y-4 text-sm">
    <section className="space-y-3" aria-label="Who answers"><h3 className="font-semibold">Who answers</h3>{who}</section>
    <section className="space-y-3" aria-label="How they talk"><h3 className="font-semibold">How they talk</h3>{how}</section>
    <section className="space-y-3" aria-label="Safety and extras"><h3 className="font-semibold">Safety and extras</h3>{extras}</section>
  </div>;
}

export function CouncilAnswerStyle({ value, onChange }: { value: "side-by-side" | "chain"; onChange: (value: "side-by-side" | "chain") => void }) {
  return <label>How seats answer<select aria-label="How seats answer" className="ml-2 h-8 rounded-md border bg-background px-2" value={value} onChange={(event) => onChange(event.target.value as "side-by-side" | "chain")}><option value="side-by-side">Side by side</option><option value="chain">One after another</option></select></label>;
}
