import { Check } from "lucide-react";
import { COUNCIL_TEMPLATES, councilCallEstimate, type CouncilTemplateId } from "../pages/council-templates";

export function CouncilTemplates({ selected, seatCount, onSelect }: { selected: CouncilTemplateId; seatCount: number; onSelect: (id: CouncilTemplateId) => void }) {
  return (
    <fieldset className="min-w-0" aria-label="War room template">
      <legend className="mb-2 text-sm font-semibold">Choose a room mode</legend>
      <div role="radiogroup" aria-label="War room modes" className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        {COUNCIL_TEMPLATES.map((template) => {
          const isSelected = selected === template.id;
          return (
            <button key={template.id} type="button" role="radio" aria-checked={isSelected} onClick={() => onSelect(template.id)} className={`min-h-28 rounded-lg border p-3 text-left transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-(length:--rad-3) sm:min-h-32 ${isSelected ? "border-primary bg-accent" : "border-border bg-background hover:bg-accent/50"}`}>
              <span className="flex items-start justify-between gap-2">
                <span className="font-medium">{template.name}</span>
                <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`} aria-hidden="true">{isSelected ? <Check className="size-3" /> : null}</span>
              </span>
              <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{template.whatHappens}</span>
              <span className="mt-3 block text-(length:--text-nano) font-medium text-muted-foreground">Estimate · about {councilCallEstimate(template, seatCount)} model calls per question</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
