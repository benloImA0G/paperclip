import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { CouncilSeat, CouncilSeatResult } from "../api/council";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Models measured in our own benchmark, per vendor (matched by connection name prefix). */
export const MODEL_CATALOG: Record<string, Array<{ model: string; note: string }>> = {
  Ollama: [
    { model: "qwen3.5:4b", note: "local · vision · ~2s (thinking off)" },
    { model: "glm-4.7-flash", note: "local · deep but slow ~30s" },
  ],
  Gemini: [
    { model: "gemini-3.5-flash-lite", note: "free tier · vision · ~1.5s" },
    { model: "gemini-3.6-flash", note: "free tier · vision · ~4s" },
  ],
  Groq: [
    { model: "openai/gpt-oss-20b", note: "fastest · ~0.5s" },
    { model: "openai/gpt-oss-120b", note: "strong reasoning · ~1s" },
  ],
  NVIDIA: [{ model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", note: "reasoning · ~1.6s" }],
};

export function catalogFor(vendor: string) {
  return MODEL_CATALOG[Object.keys(MODEL_CATALOG).find((k) => vendor.startsWith(k)) ?? ""] ?? [];
}

/** Persona presets; picking one fills the persona box, which stays editable. */
export const PERSONAS = [
  { label: "Techie", text: "A highly technical assistant who loves to explain complex topics." },
  { label: "Creative", text: "A creative thinker who loves brainstorming new ideas." },
  { label: "Friendly", text: "A warm, friendly conversationalist who is supportive and kind." },
  { label: "CodeBot", text: "A pragmatic code specialist who gives direct, working code and short answers." },
  { label: "Auditor", text: "A skeptical auditor who hunts for risks, failure modes and edge cases." },
  { label: "Architect", text: "A systems architect who weighs trade-offs and explains them clearly." },
];

export function vendorIcon(vendor: string): string {
  const v = vendor.toLowerCase();
  return v.startsWith("nvidia") ? "🟢" : v.startsWith("groq") ? "⚡" : v.startsWith("gemini") ? "✨" : v.startsWith("ollama") ? "🦙" : "🤖";
}

export function mentionOf(seat: { name: string }): string {
  return `@${seat.name.split(/\s+/)[0]}`;
}

export interface VendorDraft {
  name: string;
  model: string;
  persona: string;
}

/**
 * One vendor card: turn the vendor on or off, pick any of its models, choose or type a persona.
 * Without a seat the vendor is not selected yet; its choices are kept as a draft until it is turned on.
 * Reusable wherever a vendor + model + persona is picked (council seats, new agents).
 */
export function VendorSeatCard({
  vendor,
  color,
  seat,
  draftDefaults,
  models,
  modelsLoading,
  result,
  running,
  onActivate,
  onRemove,
  onMention,
  onUpdate,
}: {
  vendor: string;
  color: string;
  seat?: CouncilSeat;
  draftDefaults: VendorDraft;
  models: string[];
  modelsLoading?: boolean;
  result?: CouncilSeatResult;
  running?: boolean;
  onActivate: (draft: VendorDraft) => void;
  onRemove?: () => void;
  onMention?: () => void;
  onUpdate: (patch: { name?: string; persona?: string; model?: string; active?: boolean }) => void;
}) {
  const [draft, setDraft] = useState<VendorDraft>(draftDefaults);
  const active = !!seat?.active;
  const name = seat?.name ?? draft.name;
  const persona = seat?.persona ?? draft.persona;
  const model = seat?.model || draft.model || models[0] || "";
  const catalog = catalogFor(vendor);
  const note = catalog.find((m) => m.model === model)?.note;
  const rest = models.filter((m) => !catalog.some((c) => c.model === m || `${c.model}:latest` === m));
  const change = (patch: Partial<VendorDraft>) => {
    if (seat) onUpdate(patch);
    else setDraft((d) => ({ ...d, ...patch }));
  };
  const presetMatch = PERSONAS.find((p) => p.text === persona.trim())?.label ?? (persona.trim() ? "__custom" : "");
  // Typed persona text autosaves shortly after the last keystroke, so a reload never loses it.
  const [text, setText] = useState(persona);
  useEffect(() => setText(persona), [persona]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuePersona = (value: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (value.trim() !== persona.trim()) change({ persona: value });
    }, 700);
  };

  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 rounded-xl border-2 bg-card p-3 text-sm transition-opacity ${active ? "" : "opacity-60"}`}
      style={{ borderColor: active ? color : undefined }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>Vendor</div>
          <div className="font-semibold leading-tight">{vendorIcon(vendor)} {vendor.replace(/\s*\(council\)/i, "")}</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-pressed={active}
            onClick={() => (seat ? onUpdate({ active: !seat.active }) : onActivate({ ...draft, model }))}
            disabled={!seat && !model}
            className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${active ? "bg-emerald-500/10 text-emerald-500" : "text-muted-foreground"}`}
            style={active ? { borderColor: color } : undefined}
            title={active ? "Click to leave this vendor out" : "Click to bring this vendor into the council"}
          >
            {active ? "✓ Active" : "Inactive"}
          </button>
          {seat && onRemove ? (
            <button aria-label={`Remove ${seat.name}`} onClick={onRemove} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        <span className="flex justify-between">
          Bot name
          {seat && onMention ? (
            <button type="button" onClick={onMention} className="hover:underline">Direct @mention</button>
          ) : (
            <span>Direct @mention</span>
          )}
        </span>
        <Input
          key={`n-${name}`}
          defaultValue={name}
          className="h-8 text-sm"
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== name && change({ name: e.target.value.trim() })}
        />
      </label>

      <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        <span className="flex justify-between">
          Select model
          {modelsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <span>{models.length || catalog.length} available</span>}
        </span>
        <select
          className="h-8 rounded-md border bg-background px-1 text-xs text-foreground"
          value={model}
          onChange={(e) => {
            if (e.target.value === "__custom") {
              const custom = window.prompt("Model id", model)?.trim();
              if (custom && custom !== model) change({ model: custom });
            } else if (e.target.value !== model) change({ model: e.target.value });
          }}
        >
          {catalog.length ? (
            <optgroup label="Tested here">
              {catalog.map((m) => (
                <option key={m.model} value={m.model}>
                  ★ {m.model}
                </option>
              ))}
            </optgroup>
          ) : null}
          {rest.length ? (
            <optgroup label="All models from this vendor">
              {rest.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </optgroup>
          ) : null}
          {model && !catalog.some((c) => c.model === model) && !rest.includes(model) ? <option value={model}>{model}</option> : null}
          <option value="__custom">Custom model…</option>
        </select>
        <span className="min-h-3 text-[10px]"><span style={{ color }}>●</span> {note ?? (seat?.reasoningEffort === "none" ? "thinking off" : "tested model")}{seat?.acceptsImages && !note?.includes("vision") ? " · vision" : ""}{seat?.fallbacks.length ? ` · ${seat.fallbacks.length} fallback` : ""}</span>
      </label>

      <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        Persona / prompt
        <select
          className="h-7 rounded-md border bg-background px-1 text-xs text-foreground"
          value={presetMatch}
          onChange={(e) => {
            const p = PERSONAS.find((x) => x.label === e.target.value);
            if (p) change({ persona: p.text });
          }}
        >
          <option value="">Choose a persona…</option>
          {PERSONAS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
          <option value="__custom" disabled>
            Custom (typed below)
          </option>
        </select>
        <Textarea
          value={text}
          rows={2}
          className="min-h-0 text-xs"
          placeholder="Type your own persona or instructions for this vendor."
          onChange={(e) => {
            setText(e.target.value);
            queuePersona(e.target.value);
          }}
          onBlur={(e) => {
            if (saveTimer.current) clearTimeout(saveTimer.current);
            if (e.target.value.trim() !== persona.trim()) change({ persona: e.target.value });
          }}
        />
      </label>

      {running && active ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> working…
        </span>
      ) : result ? (
        <span className={`text-xs ${result.status === "ok" ? "text-emerald-600" : "text-destructive"}`}>
          {result.status === "ok" ? "answered" : result.status}
          {result.latencyMs ? ` · ${(result.latencyMs / 1000).toFixed(1)}s` : ""}
          {result.outputTokens ? ` · ${result.outputTokens} tok` : ""}
          {result.failedAttempts?.length ? ` · fell back from ${result.failedAttempts[0].model}` : ""}
        </span>
      ) : null}
    </div>
  );
}
