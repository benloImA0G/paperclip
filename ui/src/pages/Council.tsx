import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, MessagesSquare, Plus, Send, Sparkles, Square, Trash2, Users, X } from "lucide-react";
import { aiConnectionsApi } from "../api/ai-connections";
import { councilApi, type CouncilSeat, type CouncilSeatResult } from "../api/council";
import { issuesApi } from "../api/issues";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownBody } from "../components/MarkdownBody";
import { EmptyState } from "../components/EmptyState";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";

const SEAT_AUTHOR_PREFIX = "council-seat:";
const SEAT_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6", "#ef4444", "#84cc16"];

const QUICK_PROMPTS = [
  { title: "Architecture debate", hint: "Compare SQLite vs Postgres for state", text: "Compare SQLite and Postgres for storing our app state. Recommend one and say what would change your mind." },
  { title: "Coding & workers", hint: "Async worker with backpressure", text: "Design an async job worker with backpressure. Show the key code and the failure cases." },
  { title: "Security audit", hint: "Audit JWT refresh & replay protection", text: "Audit a JWT refresh-token flow for replay and theft risks. List concrete fixes." },
];

/** One-click starting council; a preset is skipped when its connection is not set up. */
const DEFAULT_SEATS = [
  { name: "Qwen 4B (local)", connection: "Ollama", model: "qwen3.5:4b", thinkingOff: true, vision: true, fallback: "gemini-3.5-flash-lite" },
  { name: "GLM 4.7 Flash (local)", connection: "Ollama", model: "glm-4.7-flash" },
  { name: "Gemini 3.5 Flash-Lite", connection: "Gemini", model: "gemini-3.5-flash-lite", vision: true },
  { name: "Gemini 3.6 Flash", connection: "Gemini", model: "gemini-3.6-flash", vision: true },
  { name: "Groq gpt-oss-120b", connection: "Groq", model: "openai/gpt-oss-120b" },
  { name: "NVIDIA Nemotron", connection: "NVIDIA", model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" },
] as const;

type RoundMode = "ask" | "discuss" | "summarize";

/** Models measured in our own benchmark, per vendor (matched by connection name prefix). */
const MODEL_CATALOG: Record<string, Array<{ model: string; note: string }>> = {
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

const PERSONAS = [
  { label: "Architect", text: "A highly technical architect who explains complex trade-offs clearly." },
  { label: "Creative", text: "A creative thinker who loves brainstorming new ideas." },
  { label: "Auditor", text: "A skeptical auditor who hunts for risks, failure modes and edge cases." },
  { label: "Pragmatic coder", text: "A pragmatic engineer who gives direct, working code and short answers." },
  { label: "Friendly", text: "A warm, supportive conversationalist who keeps things simple." },
];

/** Discussion depth: how many debate rounds run after the first answers, and how hard seats push. */
const DEPTHS = {
  low: { label: "Low (1 turn · quick takes)", rounds: 1, focus: "Keep it brief: name one point you agree with and one you disagree with." },
  medium: { label: "Medium (2 turns · trade-offs)", rounds: 2, focus: "Weigh the trade-offs between the proposals. Concede points you got wrong and say what you would now change." },
  high: { label: "High (3 turns · deep debate)", rounds: 3, focus: "Challenge assumptions, rebut specific claims by name, and in the final turn converge on one recommendation with remaining risks." },
} as const;
type Depth = keyof typeof DEPTHS;

/** Shrink to at most 1280px and re-encode as JPEG so a round request stays small. */
async function readImage(file: File): Promise<{ name: string; mediaType: string; data: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { name: file.name, mediaType: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mentionOf(seat: CouncilSeat): string {
  return `@${seat.name.split(/\s+/)[0]}`;
}

function SeatCard({
  seat,
  vendor,
  result,
  color,
  onRemove,
  onMention,
  onUpdate,
}: {
  seat: CouncilSeat;
  vendor: string;
  result?: CouncilSeatResult;
  color: string;
  onRemove: () => void;
  onMention: () => void;
  onUpdate: (patch: { name?: string; persona?: string; model?: string; active?: boolean }) => void;
}) {
  const models = MODEL_CATALOG[Object.keys(MODEL_CATALOG).find((k) => vendor.startsWith(k)) ?? ""] ?? [];
  const currentNote = models.find((m) => m.model === seat.model)?.note;
  return (
    <div
      className={`flex w-60 shrink-0 flex-col gap-2 rounded-lg border bg-card p-3 text-sm ${seat.active ? "" : "opacity-50"}`}
      style={{ borderTop: `3px solid ${color}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>Vendor</div>
          <div className="truncate font-semibold">{vendor}</div>
        </div>
        <button
          type="button"
          onClick={() => onUpdate({ active: !seat.active })}
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${seat.active ? "border-emerald-500 text-emerald-600" : "text-muted-foreground"}`}
          title="Toggle this seat on or off"
        >
          {seat.active ? "✓ Active" : "Off"}
        </button>
        <button aria-label={`Remove ${seat.name}`} onClick={onRemove} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        <span className="flex justify-between">
          Name <button type="button" onClick={onMention} className="hover:underline">@mention</button>
        </span>
        <Input
          key={`n-${seat.name}`}
          defaultValue={seat.name}
          className="h-8 text-sm"
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== seat.name && onUpdate({ name: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        Select model
        <select
          className="h-8 rounded-md border bg-background px-1 text-xs text-foreground"
          value={models.some((m) => m.model === seat.model) ? seat.model : "__custom"}
          onChange={(e) => {
            if (e.target.value === "__custom") {
              const custom = window.prompt("Model id", seat.model)?.trim();
              if (custom && custom !== seat.model) onUpdate({ model: custom });
            } else if (e.target.value !== seat.model) onUpdate({ model: e.target.value });
          }}
        >
          {models.map((m) => (
            <option key={m.model} value={m.model}>
              ★ {m.model}
            </option>
          ))}
          <option value="__custom">{models.some((m) => m.model === seat.model) ? "Custom model…" : `Custom: ${seat.model}`}</option>
        </select>
        {currentNote ? <span className="text-[10px]">{currentNote}</span> : null}
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        Persona / prompt
        <select
          className="h-7 rounded-md border bg-background px-1 text-xs text-foreground"
          value=""
          onChange={(e) => {
            const p = PERSONAS.find((x) => x.label === e.target.value);
            if (p) onUpdate({ persona: p.text });
          }}
        >
          <option value="">Preset persona…</option>
          {PERSONAS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>
        <Textarea
          key={`p-${seat.persona}`}
          defaultValue={seat.persona}
          rows={2}
          className="min-h-0 text-xs"
          placeholder="e.g. A pragmatic reviewer who is direct."
          onBlur={(e) => e.target.value.trim() !== seat.persona.trim() && onUpdate({ persona: e.target.value })}
        />
      </label>
      <span className="text-xs text-muted-foreground">
        {seat.reasoningEffort === "none" ? "thinking off" : "default thinking"}
        {seat.acceptsImages ? " · vision" : ""}
        {seat.fallbacks.length ? ` · ${seat.fallbacks.length} fallback${seat.fallbacks.length > 1 ? "s" : ""}` : ""}
      </span>
      {result ? (
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

export function Council() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [roomId, setRoomId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [lastResults, setLastResults] = useState<Record<string, CouncilSeatResult>>({});
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [discussion, setDiscussion] = useState(false);
  const [depth, setDepth] = useState<Depth>("medium");
  const [autoSummary, setAutoSummary] = useState(false);
  const [summarySeatId, setSummarySeatId] = useState("");
  const [progress, setProgress] = useState("");
  const [images, setImages] = useState<Array<{ name: string; mediaType: string; data: string }>>([]);
  const [seatForm, setSeatForm] = useState({ name: "", grantKey: "", model: "", thinkingOff: false, vision: false, fallbackKey: "", fallbackModel: "" });

  useEffect(() => setBreadcrumbs([{ label: "Council" }]), [setBreadcrumbs]);
  const companyId = selectedCompanyId ?? "";

  const rooms = useQuery({ queryKey: ["council", companyId, "rooms"], queryFn: () => councilApi.listRooms(companyId), enabled: !!companyId });
  const connections = useQuery({ queryKey: ["council", companyId, "connections"], queryFn: () => aiConnectionsApi.list(companyId), enabled: !!companyId });
  const seats = useQuery({ queryKey: ["council", companyId, roomId, "seats"], queryFn: () => councilApi.listSeats(companyId, roomId!), enabled: !!companyId && !!roomId });
  const comments = useQuery({
    queryKey: ["council", companyId, roomId, "comments"],
    queryFn: () => issuesApi.listComments(roomId!, { order: "asc" }),
    enabled: !!roomId,
  });

  useEffect(() => {
    if (!roomId && rooms.data?.length) setRoomId(rooms.data[0].id);
  }, [roomId, rooms.data]);

  const connectionOptions = ((connections.data as { connections?: Array<{ id: string; grantId: string; name: string }> } | undefined)?.connections ?? []);
  const allSeats = seats.data ?? [];
  const activeSeats = allSeats.filter((s) => s.active);
  const vendorOf = (s: CouncilSeat) => connectionOptions.find((c) => c.id === s.connectionId)?.name ?? "";
  // default summary writer: a fast non-reasoning vendor rather than whichever seat is first
  const fastSeatId = (activeSeats.find((s) => /^(gemini|groq)/i.test(vendorOf(s))) ?? activeSeats[0])?.id;
  const hasAnswers =!!comments.data?.some((c) => c.authorUserId?.startsWith(SEAT_AUTHOR_PREFIX));
  const seatColor = (seatId: string) => {
    const i = allSeats.findIndex((s) => s.id === seatId);
    return SEAT_COLORS[(i < 0 ? 0 : i) % SEAT_COLORS.length];
  };
  const seatNames = new Map(allSeats.map((s) => [`${SEAT_AUTHOR_PREFIX}${s.id}`, s.name]));
  const refresh = (what: "rooms" | "seats" | "comments") =>
    queryClient.invalidateQueries({ queryKey: what === "rooms" ? ["council", companyId, "rooms"] : ["council", companyId, roomId, what] });
  const addToMessage = (text: string) => setMessage((m) => `${m}${m && !m.endsWith(" ") ? " " : ""}${text} `);

  const createRoom = useMutation({
    mutationFn: () => councilApi.createRoom(companyId, newTitle.trim()),
    onSuccess: (room) => {
      setNewTitle("");
      setCreating(false);
      setRoomId(room.id);
      setLastResults({});
      void refresh("rooms");
    },
    onError: (e) => setError(errorText(e)),
  });

  const addSeat = useMutation({
    mutationFn: () => {
      const primary = connectionOptions.find((c) => `${c.id}:${c.grantId}` === seatForm.grantKey);
      const fallback = connectionOptions.find((c) => `${c.id}:${c.grantId}` === seatForm.fallbackKey);
      if (!primary) throw new Error("Pick a connection");
      return councilApi.addSeat(companyId, roomId!, {
        name: seatForm.name.trim() || seatForm.model.trim(),
        connectionId: primary.id,
        grantId: primary.grantId,
        model: seatForm.model.trim(),
        ...(seatForm.thinkingOff ? { reasoningEffort: "none" as const } : {}),
        ...(seatForm.vision ? { acceptsImages: true } : {}),
        ...(fallback && seatForm.fallbackModel.trim()
          ? { fallbacks: [{ connectionId: fallback.id, grantId: fallback.grantId, model: seatForm.fallbackModel.trim() }] }
          : {}),
      });
    },
    onSuccess: () => {
      setAdding(false);
      setSeatForm({ name: "", grantKey: "", model: "", thinkingOff: false, vision: false, fallbackKey: "", fallbackModel: "" });
      void refresh("seats");
    },
    onError: (e) => setError(errorText(e)),
  });

  const addDefaults = useMutation({
    mutationFn: async () => {
      const find = (prefix: string) => connectionOptions.find((c) => c.name.startsWith(prefix));
      for (const preset of DEFAULT_SEATS) {
        const conn = find(preset.connection);
        if (!conn) continue;
        const fb = "fallback" in preset ? find("Gemini") : undefined;
        await councilApi.addSeat(companyId, roomId!, {
          name: preset.name,
          connectionId: conn.id,
          grantId: conn.grantId,
          model: preset.model,
          ...("thinkingOff" in preset ? { reasoningEffort: "none" as const } : {}),
          ...("vision" in preset ? { acceptsImages: true } : {}),
          ...(fb && "fallback" in preset
            ? { fallbacks: [{ connectionId: fb.id, grantId: fb.grantId, model: preset.fallback }] }
            : {}),
        });
      }
    },
    onSettled: () => void refresh("seats"),
    onError: (e) => setError(errorText(e)),
  });

  const deleteRoom = useMutation({
    mutationFn: (id: string) => issuesApi.remove(id),
    onSuccess: (_d, id) => {
      if (id === roomId) setRoomId(null);
      void refresh("rooms");
    },
    onError: (e) => setError(errorText(e)),
  });

  const updateSeat = useMutation({
    mutationFn: ({ seatId, patch }: { seatId: string; patch: { name?: string; persona?: string; model?: string; active?: boolean } }) =>
      councilApi.updateSeat(companyId, roomId!, seatId, patch),
    onSuccess: () => void refresh("seats"),
    onError: (e) => setError(errorText(e)),
  });

  const removeSeat = useMutation({
    mutationFn: (seatId: string) => councilApi.removeSeat(companyId, roomId!, seatId),
    onSuccess: () => void refresh("seats"),
    onError: (e) => setError(errorText(e)),
  });

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [comments.data?.length, roomId]);
  const abortRef = useRef<AbortController | null>(null);

  /** "ask" = answers, then the chosen discussion rounds and summary; the others are one-off rounds. */
  const ask = useMutation({
    mutationFn: async (mode: RoundMode) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const run = (m: RoundMode, extra: { message?: string; images?: Array<{ mediaType: string; data: string }> } = {}) =>
        councilApi.runRound(
          companyId,
          roomId!,
          {
            mode: m,
            seatId: m === "summarize" ? summarySeatId || fastSeatId : undefined,
            // reasoning models spend part of the budget thinking; 1024 left them with empty answers
            maxOutputTokens: 3072,
            ...extra,
          },
          controller.signal,
        );
      const merged: CouncilSeatResult[] = [];
      const collect = (r: { results: CouncilSeatResult[] }) => merged.push(...r.results);
      const text = message.trim();
      const pics = images.map(({ mediaType, data }) => ({ mediaType, data }));
      setProgress(mode === "ask" ? "Round 1: seats answering…" : mode === "discuss" ? "Seats discussing…" : "Writing summary…");
      if (mode === "ask") {
        collect(await run("ask", { message: text, images: pics }));
        if (discussion && activeSeats.length > 1) {
          const { rounds, focus } = DEPTHS[depth];
          for (let i = 1; i <= rounds && !controller.signal.aborted; i++) {
            setProgress(`Discussion turn ${i} of ${rounds}…`);
            await refresh("comments");
            collect(await run("discuss", { message: focus }));
          }
        }
        if (autoSummary && !controller.signal.aborted) {
          setProgress("Writing 1-page summary…");
          collect(await run("summarize"));
        }
      } else {
        collect(await run(mode, { message: mode === "discuss" ? text : undefined }));
      }
      return merged;
    },
    onMutate: () => setError(null),
    onSuccess: (results) => {
      setMessage("");
      setImages([]);
      setLastResults(Object.fromEntries(results.map((r) => [r.seatId, r])));
    },
    onError: (e) => {
      if (!abortRef.current?.signal.aborted) setError(errorText(e));
    },
    onSettled: () => {
      setProgress("");
      void refresh("comments");
    },
  });

  if (!selectedCompanyId) return <EmptyState icon={Users} message="Select an organization to use Council." />;

  const canSend = !ask.isPending && !!message.trim() && activeSeats.length > 0;
  const room = rooms.data?.find((r) => r.id === roomId);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <MessagesSquare className="h-5 w-5" /> Multi-Vendor Council Chat
          </h1>
          <p className="text-xs text-muted-foreground">Post a challenge. Models from different vendors answer, debate and reconcile.</p>
        </div>
        {roomId && room ? (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            onClick={() => {
              if (window.confirm(`Delete the war room "${room.title}" and all its messages?`)) deleteRoom.mutate(room.id);
            }}
          >
            <Trash2 /> Delete room
          </Button>
        ) : null}
      </div>

      <div className="flex items-center gap-2 rounded-lg border p-2">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">War rooms</span>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
          {(rooms.data ?? []).map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setRoomId(r.id);
                setLastResults({});
              }}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm ${r.id === roomId ? "border-primary bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50"}`}
            >
              {r.title}
            </button>
          ))}
        </div>
        {creating ? (
          <form
            className="flex shrink-0 gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (newTitle.trim()) createRoom.mutate();
            }}
          >
            <Input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Room title" className="h-8 w-44" />
            <Button type="submit" size="sm" disabled={createRoom.isPending}>Create</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}><X /></Button>
          </form>
        ) : (
          <Button size="sm" className="shrink-0" onClick={() => setCreating(true)}>
            <Plus /> New war room
          </Button>
        )}
      </div>

      {!roomId ? (
        <EmptyState icon={Users} message="Create a war room to put several AI models on one question." />
      ) : (
        <>
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wide text-muted-foreground">
              Participating vendors · {activeSeats.length} of {allSeats.length} active
            </span>
            <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)}>
              <Plus /> Add seat
            </Button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {allSeats.map((seat) => (
              <SeatCard
                key={seat.id}
                seat={seat}
                vendor={connectionOptions.find((c) => c.id === seat.connectionId)?.name ?? "Vendor"}
                result={lastResults[seat.id]}
                color={seatColor(seat.id)}
                onRemove={() => removeSeat.mutate(seat.id)}
                onMention={() => addToMessage(mentionOf(seat))}
                onUpdate={(patch) => updateSeat.mutate({ seatId: seat.id, patch })}
              />
            ))}
            {!allSeats.length ? (
              <Button size="sm" onClick={() => addDefaults.mutate()} disabled={addDefaults.isPending}>
                <Sparkles /> {addDefaults.isPending ? "Adding seats…" : "Add the default council"}
              </Button>
            ) : null}
          </div>

          {adding ? (
            <form
              className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                addSeat.mutate();
              }}
            >
              <select
                className="h-9 rounded-md border bg-background px-2"
                value={seatForm.grantKey}
                onChange={(e) => setSeatForm({ ...seatForm, grantKey: e.target.value })}
                aria-label="Connection"
              >
                <option value="">Connection…</option>
                {connectionOptions.map((c) => (
                  <option key={`${c.id}:${c.grantId}`} value={`${c.id}:${c.grantId}`}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Input placeholder="Model id (e.g. qwen3.5:4b)" value={seatForm.model} onChange={(e) => setSeatForm({ ...seatForm, model: e.target.value })} />
              <Input placeholder="Seat name (optional)" value={seatForm.name} onChange={(e) => setSeatForm({ ...seatForm, name: e.target.value })} />
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={seatForm.thinkingOff} onChange={(e) => setSeatForm({ ...seatForm, thinkingOff: e.target.checked })} />
                Thinking off (fast local models)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={seatForm.vision} onChange={(e) => setSeatForm({ ...seatForm, vision: e.target.checked })} />
                Can see images (vision model)
              </label>
              <select
                className="h-9 rounded-md border bg-background px-2"
                value={seatForm.fallbackKey}
                onChange={(e) => setSeatForm({ ...seatForm, fallbackKey: e.target.value })}
                aria-label="Fallback connection"
              >
                <option value="">Fallback connection (optional)…</option>
                {connectionOptions.map((c) => (
                  <option key={`${c.id}:${c.grantId}`} value={`${c.id}:${c.grantId}`}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Input placeholder="Fallback model id" value={seatForm.fallbackModel} onChange={(e) => setSeatForm({ ...seatForm, fallbackModel: e.target.value })} />
              <div className="md:col-span-2">
                <Button type="submit" size="sm" disabled={addSeat.isPending || !seatForm.model.trim() || !seatForm.grantKey}>
                  Add seat
                </Button>
              </div>
            </form>
          ) : null}

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-md border p-3">
            {(comments.data ?? []).map((c) => {
              const seatAuthor = c.authorUserId?.startsWith(SEAT_AUTHOR_PREFIX);
              const speaker = seatAuthor ? (seatNames.get(c.authorUserId!) ?? "Seat") : "Ben";
              const color = seatAuthor ? seatColor(c.authorUserId!.slice(SEAT_AUTHOR_PREFIX.length)) : undefined;
              return (
                <div
                  key={c.id}
                  className={seatAuthor ? "rounded-md bg-muted/50 p-3" : "ml-auto max-w-[85%] rounded-md bg-primary/10 p-3"}
                  style={color ? { borderLeft: `3px solid ${color}` } : undefined}
                >
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">{speaker}</div>
                  <MarkdownBody className="text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{c.body}</MarkdownBody>
                </div>
              );
            })}
            {comments.data && !comments.data.length ? (
              <p className="text-sm text-muted-foreground">
                {allSeats.length ? "Ask the whole council one question, or start from an example below." : "This room has no seats yet."}
              </p>
            ) : null}
            {ask.isPending ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {progress || "Seats are answering…"}
              </p>
            ) : null}
            <div ref={threadEndRef} />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {comments.data && !comments.data.length && activeSeats.length ? (
            <div className="grid gap-2 md:grid-cols-3">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q.title}
                  type="button"
                  onClick={() => setMessage(q.text)}
                  className="rounded-lg border p-2 text-left hover:bg-accent/50"
                >
                  <div className="text-sm font-medium">{q.title}</div>
                  <div className="text-xs text-muted-foreground">{q.hint}</div>
                </button>
              ))}
            </div>
          ) : null}

          <form
            className="flex flex-col gap-2 rounded-xl border p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSend) ask.mutate("ask");
            }}
          >
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask the council… type detailed instructions, paste code, or tag a seat with @"
              rows={3}
              className="border-0 shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            {images.length ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {images.map((img, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                    {img.name}
                    <button type="button" aria-label={`Remove ${img.name}`} onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <span>Only seats marked "vision" can see them.</span>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-muted-foreground hover:bg-accent">
                <ImagePlus className="h-3.5 w-3.5" /> upload
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []).slice(0, 3 - images.length);
                    e.target.value = "";
                    try {
                      const read = await Promise.all(files.map(readImage));
                      setImages((prev) => [...prev, ...read].slice(0, 3));
                    } catch (err) {
                      setError(errorText(err));
                    }
                  }}
                />
              </label>
              <span className="text-muted-foreground">Tag:</span>
              {activeSeats.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => addToMessage(mentionOf(s))}
                  className="rounded-full border px-2 py-0.5 hover:bg-accent"
                  style={{ borderColor: seatColor(s.id), color: seatColor(s.id) }}
                >
                  {mentionOf(s)}
                </button>
              ))}
              <button type="button" onClick={() => addToMessage("@all")} className="rounded-full border border-primary px-2 py-0.5 text-primary hover:bg-accent">
                @Council (All)
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={discussion}
                  onClick={() => setDiscussion((v) => !v)}
                  className={`rounded-full border px-3 py-1 font-medium ${discussion ? "border-primary bg-accent" : "text-muted-foreground"}`}
                  title="After the first answers, seats read each other and debate"
                >
                  <MessagesSquare className="mr-1 inline h-3.5 w-3.5" /> Discussion: {discussion ? "ON" : "OFF"}
                </button>
                <select
                  className="h-8 rounded-md border bg-background px-2 disabled:opacity-50"
                  aria-label="Discussion depth"
                  disabled={!discussion}
                  value={depth}
                  onChange={(e) => setDepth(e.target.value as Depth)}
                >
                  {(Object.keys(DEPTHS) as Depth[]).map((d) => (
                    <option key={d} value={d}>
                      {DEPTHS[d].label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-pressed={autoSummary}
                  onClick={() => setAutoSummary((v) => !v)}
                  className={`rounded-full border px-3 py-1 font-medium ${autoSummary ? "border-primary bg-accent" : "text-muted-foreground"}`}
                  title="A seat writes a short summary at the end"
                >
                  1-page summary: {autoSummary ? "ON" : "OFF"}
                </button>
                <select
                  className="h-8 rounded-md border bg-background px-2"
                  aria-label="Summary by"
                  value={summarySeatId}
                  onChange={(e) => setSummarySeatId(e.target.value)}
                >
                  <option value="">Summary by (auto: fast seat)</option>
                  {activeSeats.map((s) => (
                    <option key={s.id} value={s.id}>
                      Summary by {s.name}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" size="sm" disabled={ask.isPending || !hasAnswers} onClick={() => ask.mutate("summarize")}>
                  Summary
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  title="Seats read the others' answers and react. Your note is optional."
                  disabled={ask.isPending || activeSeats.length < 2 || !hasAnswers}
                  onClick={() => ask.mutate("discuss")}
                >
                  Discuss now
                </Button>
              </div>
              {ask.isPending ? (
                <Button type="button" variant="destructive" onClick={() => abortRef.current?.abort()}>
                  <Square /> Stop
                </Button>
              ) : (
                <Button type="submit" disabled={!canSend}>
                  <Send /> Send
                </Button>
              )}
            </div>
          </form>
          <p className="text-xs text-muted-foreground">
            Enter sends, Shift+Enter adds a line. <code>@Groq</code> asks one seat, <code>@all</code> asks everyone.
          </p>
        </>
      )}
    </div>
  );
}
