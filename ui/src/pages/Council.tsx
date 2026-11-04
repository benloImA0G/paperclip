import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ImagePlus, Loader2, MessagesSquare, Plus, RotateCcw, Send, Square, Trash2, Users, X } from "lucide-react";
import { aiConnectionsApi } from "../api/ai-connections";
import { councilApi, type CouncilSeat, type CouncilSeatResult } from "../api/council";
import { issuesApi } from "../api/issues";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VendorSeatCard, mentionOf, vendorIcon, type VendorDraft } from "../components/VendorSeatCard";
import { MarkdownBody } from "../components/MarkdownBody";
import { EmptyState } from "../components/EmptyState";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";

const SEAT_AUTHOR_PREFIX = "council-seat:";
const DOCUMENT_EXPORT_REQUEST = /(power ?point|pptx|slides?|deck|word doc|docx|word file)/i;

/** Download text as a file in the browser (O1 of the outputs roadmap: no server round trip, no new dependency). */
function saveTextFile(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[^\w.\- ]+/g, "_");
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function saveBlobFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[^\w.\- ]+/g, "_");
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
const SEAT_COLORS = ["#10b981", "#06b6d4", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#ef4444", "#84cc16"];

const QUICK_PROMPTS = [
  { title: "Architecture debate", hint: "Compare SQLite vs Postgres for state", text: "Compare SQLite and Postgres for storing our app state. Recommend one and say what would change your mind." },
  { title: "Coding & workers", hint: "Async worker with backpressure", text: "Design an async job worker with backpressure. Show the key code and the failure cases." },
  { title: "Security audit", hint: "Audit JWT refresh & replay protection", text: "Audit a JWT refresh-token flow for replay and theft risks. List concrete fixes." },
];

/** Starting choices per vendor (matched by connection name prefix); `auto` vendors join every new room. */
const VENDOR_DEFAULTS: Record<
  string,
  { name: string; model: string; persona: string; thinkingOff?: boolean; vision?: boolean; fallback?: string; auto?: boolean }
> = {
  NVIDIA: { name: "Techie", model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", persona: "A highly technical assistant who loves to explain complex topics.", auto: true },
  Groq: { name: "Creative", model: "openai/gpt-oss-120b", persona: "A creative thinker who loves brainstorming new ideas.", auto: true },
  Gemini: { name: "Friendly", model: "gemini-3.5-flash-lite", persona: "A warm, friendly conversationalist who is supportive and kind.", vision: true, auto: true },
  Ollama: { name: "CodeBot", model: "gemma4:26b", persona: "A pragmatic code specialist who gives direct, working code and short answers.", thinkingOff: true, vision: true, fallback: "gemini-3.5-flash-lite", auto: true },
};

function defaultsFor(vendor: string) {
  return VENDOR_DEFAULTS[Object.keys(VENDOR_DEFAULTS).find((k) => vendor.startsWith(k)) ?? ""];
}

type RoundMode = "ask" | "discuss" | "summarize";

/** Discussion depth: how many debate rounds run after the first answers, and how hard seats push. */
const DEPTHS = {
  low: { label: "1 Round (Fast)", rounds: 1, focus: "Keep it brief: name one point you agree with and one you disagree with." },
  medium: { label: "2 Rounds (Trade-offs)", rounds: 2, focus: "Weigh the trade-offs between the proposals. Concede points you got wrong and say what you would now change." },
  high: { label: "3 Rounds (Deep debate)", rounds: 3, focus: "Challenge assumptions, rebut specific claims by name, and in the final turn converge on one recommendation with remaining risks." },
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

function clock(value: unknown): string {
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Toggle({ label, on, onClick, title }: { label: string; on: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-tight ${on ? "border-primary bg-accent text-foreground" : "border-border text-muted-foreground"}`}
    >
      {label}
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${on ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{on ? "ON" : "OFF"}</span>
    </button>
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
  const [discussion, setDiscussion] = useState(false);
  const [depth, setDepth] = useState<Depth>("medium");
  const [autoSummary, setAutoSummary] = useState(false);
  const [clarify, setClarify] = useState(false);
  const [showArchives, setShowArchives] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(true);
  const [summarySeatId, setSummarySeatId] = useState("");
  const [progress, setProgress] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [compactedTurns, setCompactedTurns] = useState(0);
  const [images, setImages] = useState<Array<{ name: string; mediaType: string; data: string }>>([]);
  const [exportingReply, setExportingReply] = useState<string | null>(null);

  useEffect(() => setBreadcrumbs([{ label: "Council" }]), [setBreadcrumbs]);
  const companyId = selectedCompanyId ?? "";

  const rooms = useQuery({ queryKey: ["council", companyId, "rooms"], queryFn: () => councilApi.listRooms(companyId), enabled: !!companyId });
  const archived = useQuery({ queryKey: ["council", companyId, "archived"], queryFn: () => councilApi.listArchivedRooms(companyId), enabled: !!companyId });
  const connections = useQuery({ queryKey: ["council", companyId, "connections"], queryFn: () => aiConnectionsApi.list(companyId), enabled: !!companyId });
  const seats = useQuery({ queryKey: ["council", companyId, roomId, "seats"], queryFn: () => councilApi.listSeats(companyId, roomId!), enabled: !!companyId && !!roomId });
  const comments = useQuery({
    queryKey: ["council", companyId, roomId, "comments"],
    queryFn: () => issuesApi.listComments(roomId!, { order: "asc" }),
    enabled: !!roomId,
    // each vendor's reply shows up as soon as it lands, not only when the whole debate ends
    refetchInterval: running ? 1500 : false,
  });

  useEffect(() => {
    if (!roomId && rooms.data?.length) setRoomId(rooms.data[0].id);
  }, [roomId, rooms.data]);

  const connectionOptions = ((connections.data as { connections?: Array<{ id: string; grantId: string; name: string }> } | undefined)?.connections ?? []);
  const modelLists = useQueries({
    queries: connectionOptions.map((c) => ({
      queryKey: ["council", companyId, "models", c.id, c.grantId],
      queryFn: () => councilApi.listModels(companyId, c.id, c.grantId),
      enabled: !!companyId,
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  const allSeats = seats.data ?? [];
  // one card per vendor connection; extra seats of the same connection are folded away and switched off
  const seatOf = (connectionId: string) => allSeats.find((s) => s.connectionId === connectionId);
  const primarySeats = connectionOptions.map((c) => seatOf(c.id)).filter((s): s is CouncilSeat => !!s);
  const foldedSeats = allSeats.filter((s) => !primarySeats.includes(s));
  const activeSeats = primarySeats.filter((s) => s.active);
  const vendorOf = (s: CouncilSeat) => connectionOptions.find((c) => c.id === s.connectionId)?.name ?? "";
  const fastSeatId = (activeSeats.find((s) => /^(gemini|groq)/i.test(vendorOf(s))) ?? activeSeats[0])?.id;
  const hasAnswers = !!comments.data?.some((c) => c.authorUserId?.startsWith(SEAT_AUTHOR_PREFIX));
  const colorOfConnection = (connectionId: string) => {
    const i = connectionOptions.findIndex((c) => c.id === connectionId);
    return SEAT_COLORS[(i < 0 ? 0 : i) % SEAT_COLORS.length];
  };
  const seatColor = (seatId: string) => colorOfConnection(allSeats.find((s) => s.id === seatId)?.connectionId ?? "");
  const refresh = (what: "rooms" | "seats" | "comments" | "archived") =>
    queryClient.invalidateQueries({
      queryKey: what === "rooms" || what === "archived" ? ["council", companyId, what] : ["council", companyId, roomId, what],
    });
  const addToMessage = (text: string) => setMessage((m) => `${m}${m && !m.endsWith(" ") ? " " : ""}${text} `);

  const createSeatFor = (targetRoomId: string, conn: { id: string; grantId: string; name: string }, draft: VendorDraft) => {
    const d = defaultsFor(conn.name);
    return councilApi.addSeat(companyId, targetRoomId, {
      name: draft.name.trim() || conn.name,
      persona: draft.persona,
      connectionId: conn.id,
      grantId: conn.grantId,
      model: draft.model.trim(),
      ...(d?.thinkingOff && draft.model === d.model ? { reasoningEffort: "none" as const } : {}),
      ...(d?.vision && draft.model === d.model ? { acceptsImages: true } : {}),
      ...(d?.fallback && draft.model === d.model
        ? (() => {
            const fb = connectionOptions.find((c) => c.name.startsWith("Gemini"));
            return fb ? { fallbacks: [{ connectionId: fb.id, grantId: fb.grantId, model: d.fallback! }] } : {};
          })()
        : {}),
    });
  };

  const activateVendor = useMutation({
    mutationFn: ({ conn, draft }: { conn: { id: string; grantId: string; name: string }; draft: VendorDraft }) =>
      createSeatFor(roomId!, conn, draft),
    onSettled: () => void refresh("seats"),
    onError: (e) => setError(errorText(e)),
  });

  const addDefaults = useMutation({
    mutationFn: async (targetRoomId: string) => {
      for (const conn of connectionOptions) {
        const d = defaultsFor(conn.name);
        if (d?.auto) await createSeatFor(targetRoomId, conn, { name: d.name, model: d.model, persona: d.persona });
      }
    },
    onSettled: () => void refresh("seats"),
    onError: (e) => setError(errorText(e)),
  });

  const createRoom = useMutation({
    mutationFn: () => councilApi.createRoom(companyId, newTitle.trim()),
    onSuccess: (room) => {
      setNewTitle("");
      setCreating(false);
      setRoomId(room.id);
      setLastResults({});
      void refresh("rooms");
      // a new war room starts with the default vendors switched on
      addDefaults.mutate(room.id);
    },
    onError: (e) => setError(errorText(e)),
  });

  const deleteRoom = useMutation({
    mutationFn: (id: string) => issuesApi.remove(id),
    onSuccess: (_d, id) => {
      if (id === roomId) setRoomId(null);
      void refresh("rooms");
      void refresh("archived");
    },
    onError: (e) => setError(errorText(e)),
  });

  const setArchived = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => issuesApi.update(id, { hiddenAt: on ? new Date().toISOString() : null }),
    onSuccess: (_d, { id, on }) => {
      if (on && id === roomId) setRoomId(null);
      void refresh("rooms");
      void refresh("archived");
    },
    onError: (e) => setError(errorText(e)),
  });

  const clearChat = useMutation({
    mutationFn: () => councilApi.clearMessages(companyId, roomId!),
    onSuccess: () => {
      setLastResults({});
      setCompactedTurns(0);
    },
    onSettled: () => void refresh("comments"),
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

  useEffect(() => {
    for (const s of foldedSeats) if (s.active) updateSeat.mutate({ seatId: s.id, patch: { active: false } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldedSeats.map((s) => `${s.id}${s.active}`).join()]);

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
      const run = (m: RoundMode, extra: { message?: string; images?: Array<{ mediaType: string; data: string }>; clarify?: boolean } = {}) =>
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
      let compacted = 0;
      const collect = (r: { results: CouncilSeatResult[]; compactedTurns?: number }) => {
        merged.push(...r.results);
        compacted = Math.max(compacted, r.compactedTurns ?? 0);
        setCompactedTurns(compacted);
      };
      const text = message.trim();
      const pics = images.map(({ mediaType, data }) => ({ mediaType, data }));
      const debate = mode === "ask" && discussion && activeSeats.length > 1 ? DEPTHS[depth] : null;
      const plan =
        mode === "ask"
          ? [
              "Answers",
              ...Array.from({ length: debate?.rounds ?? 0 }, (_, i) => `Discussion ${i + 1}`),
              ...(autoSummary ? ["Summary"] : []),
            ]
          : [mode === "discuss" ? "Discussion" : "Summary"];
      let step = 0;
      const begin = (label: string) => {
        setStepIdx(step++);
        setProgress(label);
      };
      setSteps(plan);
      if (mode === "ask") {
        begin("Round 1: every vendor answers in parallel…");
        collect(await run("ask", { message: text, images: pics, clarify }));
        if (debate) {
          for (let i = 1; i <= debate.rounds && !controller.signal.aborted; i++) {
            await refresh("comments");
            begin(`Discussion turn ${i} of ${debate.rounds}: vendors read each other…`);
            collect(await run("discuss", { message: debate.focus }));
          }
        }
        if (autoSummary && !controller.signal.aborted) {
          await refresh("comments");
          begin("Writing the 1-page summary…");
          collect(await run("summarize"));
        }
      } else {
        begin(mode === "discuss" ? "Vendors discussing…" : "Writing summary…");
        collect(await run(mode, { message: mode === "discuss" ? text : undefined }));
      }
      return merged;
    },
    onMutate: () => {
      setError(null);
      setRunning(true);
      // fold the vendor cards so the live conversation gets the screen
      setCardsOpen(false);
    },
    onSuccess: (results) => {
      setLastResults(Object.fromEntries(results.map((r) => [r.seatId, r])));
      // keep the draft when no vendor answered, so the question can be retried
      if (results.length && results.every((r) => r.status !== "ok")) {
        setError("No vendor answered. Your message is kept; check the vendor cards, then send again.");
        setCardsOpen(true);
        return;
      }
      setMessage("");
      setImages([]);
    },
    onError: (e) => {
      if (!abortRef.current?.signal.aborted) setError(errorText(e));
    },
    onSettled: () => {
      setProgress("");
      setRunning(false);
      setSteps([]);
      void refresh("comments");
    },
  });

  if (!selectedCompanyId) return <EmptyState icon={Users} message="Select an organization to use Council." />;

  const canSend = !ask.isPending && !!message.trim() && activeSeats.length > 0;
  const room = rooms.data?.find((r) => r.id === roomId);
  const seatById = new Map(allSeats.map((s) => [`${SEAT_AUTHOR_PREFIX}${s.id}`, s]));
  const latestUserMessage = [...(comments.data ?? [])].reverse().find((c) => !c.authorUserId?.startsWith(SEAT_AUTHOR_PREFIX));
  const finalVendorReply = [...(comments.data ?? [])].reverse().find((c) => c.authorUserId?.startsWith(SEAT_AUTHOR_PREFIX));
  const requestedDocumentExport = latestUserMessage?.body.match(DOCUMENT_EXPORT_REQUEST)?.[0] ?? "";
  const showDocumentExportCta = !running && !!requestedDocumentExport && !!finalVendorReply;
  const requestedFormats = {
    pptx: /power ?point|pptx|slides?|deck/i.test(requestedDocumentExport),
    docx: /word doc|docx|word file/i.test(requestedDocumentExport),
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="w-60 shrink-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold leading-tight">
            <MessagesSquare className="h-5 w-5" /> Multi-Vendor Council Chat
          </h1>
          <p className="text-xs text-muted-foreground">Post an engineering challenge; vendors debate and reconcile into a unified vision.</p>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          <Toggle label="2-Way Clarify:" on={clarify} onClick={() => setClarify((v) => !v)} title="Lets a vendor ask another vendor one question before answering" />
          <Toggle label="1-Page Summary:" on={autoSummary} onClick={() => setAutoSummary((v) => !v)} title="Adds a concise one-page summary after the vendors answer" />
          <label className="flex flex-col justify-center rounded-lg border px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" title="Sets how many rounds vendors comment on each other">
            Debate rounds
            <select
              className="h-7 rounded-md border bg-background px-1 text-xs normal-case text-foreground"
              value={discussion ? depth : "off"}
              onChange={(e) => {
                if (e.target.value === "off") setDiscussion(false);
                else {
                  setDiscussion(true);
                  setDepth(e.target.value as Depth);
                }
              }}
            >
              <option value="off">No debate</option>
              {(Object.keys(DEPTHS) as Depth[]).map((d) => (
                <option key={d} value={d}>
                  {DEPTHS[d].label}
                </option>
              ))}
            </select>
          </label>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground" disabled={!roomId || setArchived.isPending} onClick={() => roomId && setArchived.mutate({ id: roomId, on: true })}>
            <Archive /> Archive Thread
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-0 px-2 text-xs text-muted-foreground shadow-none hover:bg-destructive/10 hover:text-destructive"
            disabled={!roomId || !room || running}
            title={running ? "Stop the running round first" : undefined}
            onClick={() => {
              if (room && window.confirm(`Delete the war room "${room.title}" and all its messages?`)) deleteRoom.mutate(room.id);
            }}
          >
            <Trash2 /> Delete Thread
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground" onClick={() => setShowArchives((v) => !v)}>
            Archives <span className="rounded-full bg-accent px-1.5 text-xs">{archived.data?.length ?? 0}</span>
          </Button>
          <Button
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={!roomId || !comments.data?.length || clearChat.isPending}
            onClick={() => {
              if (window.confirm("Clear every message in this war room? The vendors stay.")) clearChat.mutate();
            }}
          >
            Clear Chat
          </Button>
        </div>
      </div>

      {showArchives ? (
        <div className="rounded-lg border p-2 text-sm">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Archived war rooms</div>
          {archived.data?.length ? (
            archived.data.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 py-1">
                <span>{r.title}</span>
                <span className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setArchived.mutate({ id: r.id, on: false })}>
                    <RotateCcw /> Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => window.confirm(`Delete "${r.title}" for good?`) && deleteRoom.mutate(r.id)}
                  >
                    <Trash2 />
                  </Button>
                </span>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Nothing archived.</p>
          )}
        </div>
      ) : null}

      <div className="flex items-center gap-2 rounded-lg border p-2">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">War rooms</span>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
          {(rooms.data ?? []).map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setRoomId(r.id);
                setLastResults({});
                setCompactedTurns(0);
              }}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm ${r.id === roomId ? "border-primary bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50"}`}
            >
              <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${r.id === roomId ? "bg-emerald-400" : "bg-muted-foreground/50"}`} />
              {r.title}
            </button>
          ))}
          <button
            type="button"
            aria-label="New war room"
            onClick={() => setCreating(true)}
            className="shrink-0 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground hover:bg-accent/50"
          >
            +
          </button>
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
              ● Select participating vendors <span className="font-normal normal-case">· click Active / Inactive to include a vendor · selected vendors respond concurrently</span>
            </span>
            <span className="flex items-center gap-2">
              <button type="button" onClick={() => setCardsOpen((v) => !v)} className="rounded-md border px-2 py-0.5 text-[11px] hover:bg-accent">
                {cardsOpen ? "▴ Hide vendor settings" : "▾ Show vendor settings"}
              </button>
              <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                {activeSeats.length} model{activeSeats.length === 1 ? "" : "s"} selected
              </span>
            </span>
          </div>
          {!cardsOpen ? (
            <div className="flex shrink-0 flex-wrap gap-2">
              {connectionOptions.map((conn) => {
                const seat = seatOf(conn.id);
                const color = colorOfConnection(conn.id);
                return (
                  <button
                    key={`${conn.id}:${conn.grantId}`}
                    type="button"
                    disabled={!seat}
                    onClick={() => seat && updateSeat.mutate({ seatId: seat.id, patch: { active: !seat.active } })}
                    className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs ${seat?.active ? "" : "opacity-50"}`}
                    style={{ borderColor: seat?.active ? color : undefined }}
                    title="Click to switch this vendor on or off"
                  >
                    {vendorIcon(conn.name)} <b>{seat?.name ?? conn.name}</b>
                    <span className="text-muted-foreground">{seat?.model ?? "not in this room"}</span>
                    {running && seat?.active ? <Loader2 className="h-3 w-3 animate-spin" /> : seat?.active ? "✓" : ""}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className={`${cardsOpen ? "grid" : "hidden"} shrink-0 gap-3 pb-2 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]`}>
            {connectionOptions.map((conn, i) => {
              const seat = seatOf(conn.id);
              const d = defaultsFor(conn.name);
              return (
                <VendorSeatCard
                  key={`${conn.id}:${conn.grantId}`}
                  vendor={conn.name}
                  color={colorOfConnection(conn.id)}
                  seat={seat}
                  draftDefaults={{ name: d?.name ?? conn.name.split(/\s+/)[0], model: d?.model ?? "", persona: d?.persona ?? "" }}
                  models={modelLists[i]?.data ?? []}
                  modelsLoading={modelLists[i]?.isLoading}
                  result={seat ? lastResults[seat.id] : undefined}
                  running={running}
                  onActivate={(draft) => activateVendor.mutate({ conn, draft })}
                  onRemove={seat ? () => removeSeat.mutate(seat.id) : undefined}
                  onMention={seat ? () => addToMessage(mentionOf(seat)) : undefined}
                  onUpdate={(patch) => seat && updateSeat.mutate({ seatId: seat.id, patch })}
                />
              );
            })}
            {!connectionOptions.length ? <p className="text-sm text-muted-foreground">No AI connections yet. Add one in Settings.</p> : null}
          </div>

          {running && steps.length ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs">
              {steps.map((label, i) => (
                <span
                  key={label}
                  className={`rounded-full border px-2 py-0.5 ${i < stepIdx ? "border-emerald-500 text-emerald-600" : i === stepIdx ? "border-primary bg-accent font-medium" : "text-muted-foreground"}`}
                >
                  {i < stepIdx ? "✓ " : ""}
                  {label}
                </span>
              ))}
              <span className="flex items-center gap-1 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {progress}
              </span>
            </div>
          ) : null}

          <div className="min-h-[18rem] flex-1 space-y-3 overflow-y-auto rounded-md border p-3">
            {(comments.data ?? []).map((c) => {
              const seat = c.authorUserId ? seatById.get(c.authorUserId) : undefined;
              const seatAuthor = !!c.authorUserId?.startsWith(SEAT_AUTHOR_PREFIX);
              if (!seatAuthor) {
                return (
                  <div key={c.id} className="ml-auto max-w-[80%] rounded-2xl bg-indigo-600 px-4 py-2 text-white">
                    <MarkdownBody className="text-sm text-white [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{c.body}</MarkdownBody>
                    <div className="mt-1 text-right text-[10px] opacity-70">{clock(c.createdAt)}</div>
                  </div>
                );
              }
              const color = seat ? seatColor(seat.id) : "#888";
              const name = seat?.name ?? "Seat";
              return (
                <div key={c.id} className="flex gap-2">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold"
                    style={{ borderColor: color, color }}
                  >
                    {name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1 rounded-lg bg-muted/50 p-3" style={{ borderLeft: `3px solid ${color}` }}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold" style={{ color }}>
                      <span>
                        @{name} • {seat ? vendorOf(seat) : "Vendor"}
                        {seat ? ` (${seat.model})` : ""}
                      </span>
                      <span className="font-normal text-muted-foreground">{clock(c.createdAt)}</span>
                    </div>
                    <MarkdownBody className="text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{c.body}</MarkdownBody>
                    <div className="mt-1 flex justify-end gap-2 text-[10px] text-muted-foreground">
                      <select
                        aria-label="Save reply as"
                        className="h-6 rounded-md border bg-background px-1 text-[10px] text-foreground"
                        value=""
                        disabled={!!exportingReply}
                        onChange={async (e) => {
                          const format = e.target.value as "md" | "txt" | "docx" | "pptx";
                          if (!format) return;
                          const exportKey = `${c.id}:${format}`;
                          if (format === "md" || format === "txt") {
                            saveTextFile(`${room?.title ?? "council"}-${name}.${format}`, c.body);
                            return;
                          }
                          setExportingReply(exportKey);
                          try {
                            saveBlobFile(`${room?.title ?? "council"}-${name}.${format}`, await councilApi.exportDocument(companyId, format, room?.title ?? "Council reply", c.body));
                          } catch (err) {
                            setError(`Could not create the .${format}: ${errorText(err)}`);
                          } finally {
                            setExportingReply(null);
                          }
                        }}
                      >
                        <option value="" disabled>Save as</option>
                        <option value="md">Markdown (.md)</option>
                        <option value="txt">Text (.txt)</option>
                        <option value="docx">Word (.docx)</option>
                        <option value="pptx">PowerPoint (.pptx)</option>
                      </select>
                    </div>
                    {showDocumentExportCta && c.id === finalVendorReply?.id ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                        <span className="mr-1 text-xs font-medium text-foreground">Ready to download:</span>
                        {requestedFormats.pptx ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={!!exportingReply}
                            onClick={async () => {
                              setExportingReply(`${c.id}:pptx`);
                              try {
                                saveBlobFile(`${room?.title ?? "council"}.${"pptx"}`, await councilApi.exportDocument(companyId, "pptx", room?.title ?? "Council reply", c.body));
                              } catch (err) {
                                setError(`Could not create the .pptx: ${errorText(err)}`);
                              } finally {
                                setExportingReply(null);
                              }
                            }}
                          >
                            {exportingReply === `${c.id}:pptx` ? <Loader2 className="animate-spin" /> : null} Download PowerPoint
                          </Button>
                        ) : null}
                        {requestedFormats.docx ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={!!exportingReply}
                            onClick={async () => {
                              setExportingReply(`${c.id}:docx`);
                              try {
                                saveBlobFile(`${room?.title ?? "council"}.${"docx"}`, await councilApi.exportDocument(companyId, "docx", room?.title ?? "Council reply", c.body));
                              } catch (err) {
                                setError(`Could not create the .docx: ${errorText(err)}`);
                              } finally {
                                setExportingReply(null);
                              }
                            }}
                          >
                            {exportingReply === `${c.id}:docx` ? <Loader2 className="animate-spin" /> : null} Download Word
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {comments.data && !comments.data.length ? (
              <p className="text-sm text-muted-foreground">
                {activeSeats.length ? "Ask the council one question, or start from an example below." : "Switch at least one vendor to Active, then ask."}
              </p>
            ) : null}
            <div ref={threadEndRef} />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {compactedTurns > 0 ? (
            <p className="text-xs text-emerald-600">
              Token saver: {compactedTurns} older turn{compactedTurns > 1 ? "s were" : " was"} sent to the vendors as short digests. The full text stays in this thread.
            </p>
          ) : null}

          {activeSeats.length ? (
            <div className="grid shrink-0 gap-2 md:grid-cols-3">
              {QUICK_PROMPTS.map((q) => (
                <button key={q.title} type="button" onClick={() => setMessage(q.text)} className="rounded-lg border p-2 text-left hover:bg-accent/50">
                  <div className="text-sm font-medium">{q.title}</div>
                  <div className="text-xs text-muted-foreground">{q.hint}</div>
                </button>
              ))}
            </div>
          ) : null}

          <form
            className="flex shrink-0 flex-col gap-2 rounded-xl border p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSend) ask.mutate("ask");
            }}
          >
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Ask the council… type detailed instructions, paste code, or tag ${activeSeats.slice(0, 3).map(mentionOf).join(", ") || "a vendor"}`}
              rows={3}
              className="border-0 shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <p className="px-2 text-xs text-muted-foreground">Tip: ask for a PowerPoint or Word file and a download button appears.</p>
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
                <span>Only vendors with vision can see them.</span>
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
                  title="After the first answers, vendors read each other and debate"
                >
                  <MessagesSquare className="mr-1 inline h-3.5 w-3.5" /> Discussion: {discussion ? "ON" : "OFF"}
                </button>
                <select
                  className="h-8 rounded-md border bg-background px-2 disabled:opacity-50"
                  aria-label="Discussion depth"
                  title="Sets how many rounds vendors comment on each other"
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
                <select
                  className="h-8 rounded-md border bg-background px-2"
                  aria-label="Summary by"
                  value={summarySeatId}
                  onChange={(e) => setSummarySeatId(e.target.value)}
                >
                  <option value="">Summary by (auto: fast vendor)</option>
                  {activeSeats.map((s) => (
                    <option key={s.id} value={s.id}>
                      Summary by {s.name}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" size="sm" className="border-primary/60 bg-primary/10" title="Creates a concise one-page summary of the discussion" disabled={ask.isPending || !hasAnswers} onClick={() => ask.mutate("summarize")}>
                  Summary
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  title="Vendors read the others' answers and react. Your note is optional."
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
            Enter sends, Shift+Enter adds a line. Tag one vendor with its @name, or <code>@all</code> for everyone.
          </p>
        </>
      )}
    </div>
  );
}
