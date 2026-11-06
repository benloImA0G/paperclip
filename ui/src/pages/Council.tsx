import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronDown, ImagePlus, Loader2, MessagesSquare, MoreHorizontal, RotateCcw, Send, Settings2, Square, Trash2, Users, X } from "lucide-react";
import { aiConnectionsApi } from "../api/ai-connections";
import { councilApi, type CouncilModeSuggestion, type CouncilSeat, type CouncilSeatResult } from "../api/council";
import { issuesApi } from "../api/issues";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VendorSeatCard, mentionOf, vendorIcon, type VendorDraft } from "../components/VendorSeatCard";
import { MarkdownBody } from "../components/MarkdownBody";
import { EmptyState } from "../components/EmptyState";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { parseCouncilDecisionRecord } from "./council-decision-record";
import { CouncilAgreementMeter } from "../components/CouncilAgreement";
import { CouncilWorkPanel } from "../components/CouncilWorkPanel";
import type { CouncilAgreement } from "../api/council";
import { ActionItemsChecklist, CreateTaskFromDecisionButton, LinkedTasksPanel } from "../components/CouncilTaskBridge";
import { CouncilAgentPanel } from "../components/CouncilAgentPanel";
import { CouncilEstimate } from "../components/CouncilEstimate";
import { queryKeys } from "../lib/queryKeys";
import { Link } from "../lib/router";
import { CouncilTemplates } from "../components/CouncilTemplates";
import { COUNCIL_TEMPLATES, DEFAULT_COUNCIL_TEMPLATE_ID, type CouncilTemplateId } from "./council-templates";
import type { CouncilRoundOrder, CouncilRoundStyle } from "@paperclipai/shared";

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
const SEAT_COLORS = [
  "var(--council-seat-color-1)",
  "var(--council-seat-color-2)",
  "var(--council-seat-color-3)",
  "var(--council-seat-color-4)",
  "var(--council-seat-color-5)",
  "var(--council-seat-color-6)",
  "var(--council-seat-color-7)",
  "var(--council-seat-color-8)",
];

const QUICK_PROMPTS = [
  { title: "Architecture debate", hint: "Compare SQLite vs Postgres for state", text: "Compare SQLite and Postgres for storing our app state. Recommend one and say what would change your mind." },
  { title: "Coding & workers", hint: "Async worker with backpressure", text: "Design an async job worker with backpressure. Show the key code and the failure cases." },
  { title: "Security audit", hint: "Audit JWT refresh & replay protection", text: "Audit a JWT refresh-token flow for replay and theft risks. List concrete fixes." },
];

/** Starting choices per vendor (matched by connection name prefix); `auto` vendors join every new room. */
const VENDOR_DEFAULTS: Record<
  string,
  { name: string; model: string; persona: string; thinkingOff?: boolean; vision?: boolean; fallback?: string; fallbackVendor?: string; auto?: boolean }
> = {
  NVIDIA: { name: "Techie", model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", persona: "A highly technical assistant who loves to explain complex topics.", fallback: "openai/gpt-oss-120b", fallbackVendor: "Groq", auto: true },
  Groq: { name: "Creative", model: "openai/gpt-oss-120b", persona: "A creative thinker who loves brainstorming new ideas.", fallback: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", fallbackVendor: "NVIDIA", auto: true },
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
  agree: { label: "Until agreement (up to 3)", rounds: 3, focus: "Weigh the proposals above. Concede what you got wrong, say what you would now change, and move toward one recommendation you can support." },
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

function QueryState({ label, loading, error, onRetry }: { label: string; loading: boolean; error: boolean; onRetry: () => void }) {
  if (loading) return <div className="animate-pulse rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Loading {label}…</div>;
  if (error) return <div role="alert" className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive"><span>Couldn’t load {label}.</span><button type="button" className="underline" onClick={onRetry}>Retry</button></div>;
  return null;
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
      <span className={`rounded-full px-1.5 py-0.5 text-(length:--text-nano) font-semibold ${on ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{on ? "ON" : "OFF"}</span>
    </button>
  );
}

function agentSeatLabel(seat: CouncilSeat) {
  return seat.adapterTypeLabel.toLowerCase().includes("hermes") ? "Hermes" : "Agent";
}

function AgentSeatSettings({ seat, onUpdate, onRemove }: {
  seat: CouncilSeat;
  onUpdate: (patch: { name?: string; role?: CouncilSeat["role"] }) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card p-3 text-sm sm:flex-row sm:items-center">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Name for {seat.name}</span>
        <Input defaultValue={seat.name} className="h-8" aria-label={`Name for ${seat.name}`} onBlur={(event) => {
          const name = event.target.value.trim();
          if (name && name !== seat.name) onUpdate({ name });
        }} />
        <span className="mt-1 block truncate text-xs text-muted-foreground">{seat.adapterTypeLabel}</span>
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Role</span>
        <select className="h-8 rounded-md border bg-background px-1 text-xs text-foreground" aria-label={`Role for ${seat.name}`} value={seat.role} onChange={(event) => onUpdate({ role: event.target.value as CouncilSeat["role"] })}>
          <option value="none">None</option><option value="moderator">Orchestrator</option><option value="critic">Critic</option><option value="researcher">Researcher</option><option value="builder">Builder</option><option value="synthesizer">Synthesizer</option>
        </select>
      </label>
      <Button type="button" variant="outline" size="sm" aria-label={`Remove ${seat.name} from this room`} onClick={onRemove}>Remove</Button>
    </div>
  );
}

export function Council() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [roomId, setRoomId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<CouncilTemplateId>(DEFAULT_COUNCIL_TEMPLATE_ID);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [brief, setBrief] = useState("");
  const [briefOpen, setBriefOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<string | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [artifactDraft, setArtifactDraft] = useState<{ markdown: string; title: string } | null>(null);
  const [requireApproval, setRequireApproval] = useState(false);
  const [lastResults, setLastResults] = useState<Record<string, Record<string, CouncilSeatResult>>>({});
  const [roundDetails, setRoundDetails] = useState<Record<string, CouncilSeatResult[][]>>({});
  const [agreements, setAgreements] = useState<Record<string, { agreement: CouncilAgreement; round: number }>>({});
  const [error, setError] = useState<string | null>(null);
  const [discussion, setDiscussion] = useState(false);
  const [depth, setDepth] = useState<Depth>("medium");
  const [autoSummary, setAutoSummary] = useState(false);
  const [clarify, setClarify] = useState(false);
  const [peerRanking, setPeerRanking] = useState(false);
  const [jury, setJury] = useState(false);
  const [panelSize, setPanelSize] = useState(0);
  const [workTasks, setWorkTasks] = useState(false);
  const [planFirst, setPlanFirst] = useState(false);
  const [suggestion, setSuggestion] = useState<CouncilModeSuggestion | null>(null);
  useEffect(() => {
    const text = message.trim();
    if (text.length < 12 || !selectedCompanyId) { setSuggestion(null); return; }
    const timer = setTimeout(() => { councilApi.classify(selectedCompanyId, text).then(setSuggestion).catch(() => setSuggestion(null)); }, 600);
    return () => clearTimeout(timer);
  }, [message, selectedCompanyId]);
  const [showArchives, setShowArchives] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [advancedMode, setAdvancedMode] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const optionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [summarySeatId, setSummarySeatId] = useState("");
  const [progress, setProgress] = useState("");
  const [running, setRunning] = useState(false);
  const [stoppedNote, setStoppedNote] = useState(false);
  const [pendingDefaultRoomId, setPendingDefaultRoomId] = useState<string | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<{ roomId: string; templateId: CouncilTemplateId } | null>(null);
  const [defaultsReadyRoomId, setDefaultsReadyRoomId] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [compactedTurns, setCompactedTurns] = useState(0);
  const [images, setImages] = useState<Array<{ name: string; mediaType: string; data: string }>>([]);
  const [exportingReply, setExportingReply] = useState<string | null>(null);
  const [consolidatePptx, setConsolidatePptx] = useState(true);
  const [lastExportNoteByRoom, setLastExportNoteByRoom] = useState<Record<string, string>>({});
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const reviewAbortRef = useRef<AbortController | null>(null);
  const lastExportNote = roomId ? lastExportNoteByRoom[roomId] ?? null : null;

  useEffect(() => setBreadcrumbs([{ label: "Council" }]), [setBreadcrumbs]);
  useEffect(() => {
    try {
      setAdvancedMode(window.localStorage.getItem("paperclip:council:mode") === "advanced");
    } catch { /* unavailable storage is fine */ }
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem("paperclip:council:mode", advancedMode ? "advanced" : "simple"); } catch { /* unavailable storage is fine */ }
  }, [advancedMode]);
  useEffect(() => {
    if (!moreOpen && !optionsOpen && !settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (moreOpen) { setMoreOpen(false); moreTriggerRef.current?.focus(); }
      if (optionsOpen) { setOptionsOpen(false); optionsTriggerRef.current?.focus(); }
      if (settingsOpen) { setSettingsOpen(false); settingsTriggerRef.current?.focus(); }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (moreOpen && !moreTriggerRef.current?.parentElement?.contains(target)) { setMoreOpen(false); moreTriggerRef.current?.focus(); }
      if (optionsOpen && !optionsTriggerRef.current?.parentElement?.contains(target)) { setOptionsOpen(false); optionsTriggerRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.removeEventListener("pointerdown", onPointerDown); };
  }, [moreOpen, optionsOpen, settingsOpen]);
  const companyId = selectedCompanyId ?? "";

  const rooms = useQuery({ queryKey: ["council", companyId, "rooms"], queryFn: () => councilApi.listRooms(companyId), enabled: !!companyId });
  const archived = useQuery({ queryKey: ["council", companyId, "archived"], queryFn: () => councilApi.listArchivedRooms(companyId), enabled: !!companyId });
  const connections = useQuery({ queryKey: ["council", companyId, "connections"], queryFn: () => aiConnectionsApi.list(companyId), enabled: !!companyId });
  const seats = useQuery({ queryKey: ["council", companyId, roomId, "seats"], queryFn: () => councilApi.listSeats(companyId, roomId!), enabled: !!companyId && !!roomId });
  const briefQuery = useQuery({ queryKey: ["council", companyId, roomId, "brief"], queryFn: () => councilApi.getBrief(companyId, roomId!), enabled: !!companyId && !!roomId });
  const roomIssueQuery = useQuery({ queryKey: queryKeys.issues.detail(roomId ?? ""), queryFn: () => issuesApi.get(roomId!), enabled: !!roomId });
  const workQuery = useQuery({
    queryKey: ["council", companyId, roomId, "work"],
    queryFn: () => councilApi.getWork(companyId, roomId!),
    enabled: !!companyId && !!roomId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  });
  const workStatus = workQuery.data?.status;
  const previousWorkStatus = useRef(workStatus);
  useEffect(() => {
    if (previousWorkStatus.current === "running" && workStatus && workStatus !== "running") void comments.refetch();
    previousWorkStatus.current = workStatus;
  }, [workStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  const startWork = useMutation({
    mutationFn: (input: { goal: string; decision?: string; postGoal?: boolean; createTasks?: boolean }) => councilApi.startWork(companyId, roomId!, input),
    onSuccess: () => { void workQuery.refetch(); void comments.refetch(); },
    onError: (e) => setError(errorText(e)),
  });
  const reliabilityQuery = useQuery({ queryKey: ["council", companyId, roomId, "reliability"], queryFn: () => councilApi.getReliability(companyId, roomId!), enabled: !!companyId && !!roomId });
  const artifactsQuery = useQuery({ queryKey: ["council", companyId, roomId, "artifacts"], queryFn: () => councilApi.listArtifacts(companyId, roomId!), enabled: !!companyId && !!roomId });
  const artifactQuery = useQuery({ queryKey: ["council", companyId, roomId, "artifact", selectedArtifactKey, selectedRevision], queryFn: () => councilApi.getArtifact(companyId, roomId!, selectedArtifactKey!, selectedRevision), enabled: !!companyId && !!roomId && !!selectedArtifactKey });
  const exportSettingQuery = useQuery({ queryKey: ["council", companyId, roomId, "export-setting"], queryFn: () => councilApi.getExportSetting(companyId, roomId!), enabled: !!companyId && !!roomId });
  useEffect(() => setBrief(briefQuery.data?.brief ?? ""), [briefQuery.data?.brief, roomId]);
  useEffect(() => setRequireApproval(exportSettingQuery.data?.requireApproval ?? false), [exportSettingQuery.data?.requireApproval, roomId]);
  const saveBrief = useMutation({ mutationFn: (savedRoomId: string) => councilApi.updateBrief(companyId, savedRoomId, brief), onSuccess: (data, savedRoomId) => { if (savedRoomId === roomId) setBrief(data.brief); void briefQuery.refetch(); } });
  const saveArtifact = useMutation({ mutationFn: (input: { companyId: string; roomId: string; artifact: { key: string; title: string; markdown: string } }) => councilApi.saveArtifact(input.companyId, input.roomId, input.artifact), onSuccess: (artifact, input) => { if (input.companyId === companyId && input.roomId === roomId) { setSelectedArtifactKey(artifact.key); setSelectedRevision(null); } setArtifactDraft(null); void artifactsQuery.refetch(); } });
  const reviewArtifact = useMutation({ mutationFn: (target: { companyId: string; roomId: string; key: string }) => { reviewAbortRef.current = new AbortController(); return councilApi.reviewArtifact(target.companyId, target.roomId, target.key, reviewAbortRef.current.signal); }, onSuccess: (result, target) => { reviewAbortRef.current = null; if (target.companyId !== companyId || target.roomId !== roomId || target.key !== selectedArtifactKey) return; setSelectedRevision(null); setReviewNotice(`Saved as v${result.revision} — critiques are in the thread`); void artifactsQuery.refetch(); void artifactQuery.refetch(); void comments.refetch(); }, onError: (err) => { reviewAbortRef.current = null; setReviewNotice(null); setError(errorText(err).includes("409") ? "The artifact changed while reviewing; reload it" : `Could not review artifact: ${errorText(err)}`); } });
  const saveExportSetting = useMutation({ mutationFn: ({ targetRoomId, value }: { targetRoomId: string; value: boolean }) => councilApi.updateExportSetting(companyId, targetRoomId, value), onSuccess: (data, { targetRoomId }) => { if (targetRoomId === roomId) setRequireApproval(data.requireApproval); } });
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
  // Keep every persisted seat visible. A connection can have multiple seats; display is not mutation authority.
  const seatOf = (connectionId: string) => allSeats.find((s) => s.connectionId === connectionId);
  const activeSeats = allSeats.filter((s) => s.active);
  const vendorOf = (s: CouncilSeat) => s.kind === "agent" ? s.adapterTypeLabel : connectionOptions.find((c) => c.id === s.connectionId)?.name ?? "";
  const fastSeatId = (activeSeats.find((s) => /^(gemini|groq)/i.test(vendorOf(s))) ?? activeSeats[0])?.id;
  const hasAnswers = !!comments.data?.some((c) => c.authorUserId?.startsWith(SEAT_AUTHOR_PREFIX));
  const colorOfConnection = (connectionId: string) => {
    const i = connectionOptions.findIndex((c) => c.id === connectionId);
    return SEAT_COLORS[(i < 0 ? 0 : i) % SEAT_COLORS.length];
  };
  const seatColor = (seatId: string) => {
    const seat = allSeats.find((candidate) => candidate.id === seatId);
    if (seat?.connectionId) return colorOfConnection(seat.connectionId);
    return SEAT_COLORS[Math.max(0, allSeats.findIndex((candidate) => candidate.id === seatId)) % SEAT_COLORS.length];
  };
  const refresh = (what: "rooms" | "seats" | "comments" | "archived") =>
    queryClient.invalidateQueries({
      queryKey: what === "rooms" || what === "archived" ? ["council", companyId, what] : ["council", companyId, roomId, what],
    });
  const refreshSeatsFor = (targetRoomId: string) => queryClient.invalidateQueries({ queryKey: ["council", companyId, targetRoomId, "seats"] });
  const addToMessage = (text: string) => setMessage((m) => `${m}${m && !m.endsWith(" ") ? " " : ""}${text} `);

  const createSeatFor = (targetRoomId: string, conn: { id: string; grantId: string; name: string }, draft: VendorDraft) => {
    const d = defaultsFor(conn.name);
    return councilApi.addSeat(companyId, targetRoomId, {
      name: draft.name.trim() || conn.name,
      persona: draft.persona,
      connectionId: conn.id,
      grantId: conn.grantId,
      model: draft.model.trim(),
      role: draft.role ?? "none",
      ...(d?.thinkingOff && draft.model === d.model ? { reasoningEffort: "none" as const } : {}),
      ...(d?.vision && draft.model === d.model ? { acceptsImages: true } : {}),
      ...(d?.fallback && draft.model === d.model
        ? (() => {
            const fb = connectionOptions.find((c) => c.name.startsWith(d.fallbackVendor ?? "Gemini"));
            return fb ? { fallbacks: [{ connectionId: fb.id, grantId: fb.grantId, model: d.fallback! }] } : {};
          })()
        : {}),
    });
  };

  const activateVendor = useMutation({
    mutationFn: ({ conn, draft }: { conn: { id: string; grantId: string; name: string }; draft: VendorDraft }) =>
      createSeatFor(roomId!, conn, draft),
    onSettled: () => void refresh("seats"),
    onError: () => setError("Couldn’t add this seat. Try again."),
  });

  const addDefaults = useMutation({
    mutationFn: async (targetRoomId: string) => {
      for (const conn of connectionOptions) {
        const d = defaultsFor(conn.name);
        if (d?.auto) await createSeatFor(targetRoomId, conn, { name: d.name, model: d.model, persona: d.persona, role: conn.name.startsWith("Groq") ? "moderator" : "none" });
      }
    },
    onSettled: async (_data, _error, targetRoomId) => {
      setDefaultsReadyRoomId(targetRoomId);
      await seats.refetch();
      void refreshSeatsFor(targetRoomId);
    },
    onError: () => setError("Couldn’t add the default seats. Try again."),
  });

  const applyTemplate = (id: CouncilTemplateId) => {
    const template = COUNCIL_TEMPLATES.find((candidate) => candidate.id === id)!;
    setSelectedTemplate(id);
    setNewTitle(template.title);
    setDiscussion(template.discussion);
    setDepth(template.depth);
    setAutoSummary(template.autoSummary);
    setRequireApproval(template.requireApproval);
  };

  const createRoom = useMutation({
    mutationFn: () => councilApi.createRoom(companyId, newTitle.trim()),
    onSuccess: (room) => {
      setNewTitle("");
      setCreating(false);
      setRoomId(room.id);
      setLastResults((current) => ({ ...current, [room.id]: {} }));
      setRoundDetails((current) => ({ ...current, [room.id]: [] }));
      setPendingDefaultRoomId(room.id);
      setDefaultsReadyRoomId(null);
      setPendingTemplate({ roomId: room.id, templateId: selectedTemplate });
      void refresh("rooms");
    },
    onError: () => setError("Couldn’t create this room. Try again."),
  });

  useEffect(() => {
    if (!pendingDefaultRoomId || !connections.isSuccess || !connectionOptions.length || addDefaults.isPending) return;
    const targetRoomId = pendingDefaultRoomId;
    setPendingDefaultRoomId(null);
    // Wait for the connection query so defaults carry the current grant/model data.
    addDefaults.mutate(targetRoomId);
  }, [addDefaults, connectionOptions.length, connections.isSuccess, pendingDefaultRoomId]);

  useEffect(() => {
    if (!pendingTemplate) return;
    if (pendingTemplate.roomId !== roomId) { setPendingTemplate(null); return; }
    const template = COUNCIL_TEMPLATES.find((candidate) => candidate.id === pendingTemplate.templateId)!;
    if (!saveExportSetting.isPending && template.requireApproval !== (exportSettingQuery.data?.requireApproval ?? false)) {
      saveExportSetting.mutate({ targetRoomId: pendingTemplate.roomId, value: template.requireApproval });
    }
    if (addDefaults.isPending || !seats.isSuccess || defaultsReadyRoomId !== roomId) return;
    const roleUpdates = allSeats.filter((seat) => template.roles[seat.name] && seat.role !== template.roles[seat.name]);
    const missing = Object.keys(template.roles).filter((name) => !allSeats.some((seat) => seat.name === name));
    if (missing.length) setError(`Template note: missing seats — ${missing.join(", ")}. Existing seats were applied.`);
    if (roleUpdates.length) {
      setPendingTemplate(null);
      void Promise.all(roleUpdates.map((seat) => councilApi.updateSeat(companyId, pendingTemplate.roomId, seat.id, { name: seat.name, role: template.roles[seat.name] })))
        .then(() => refreshSeatsFor(pendingTemplate.roomId))
        .catch(() => setError("Couldn’t update the template seats. Try again."));
    } else {
      setPendingTemplate(null);
    }
  }, [addDefaults.isPending, allSeats, companyId, defaultsReadyRoomId, exportSettingQuery.data?.requireApproval, pendingTemplate, refreshSeatsFor, roomId, saveExportSetting, saveExportSetting.isPending, seats.isSuccess]);

  const deleteRoom = useMutation({
    mutationFn: (id: string) => issuesApi.remove(id),
    onSuccess: (_d, id) => {
      if (id === roomId) setRoomId(null);
      void refresh("rooms");
      void refresh("archived");
    },
    onError: () => setError("Couldn’t delete this room. Try again."),
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
      setLastResults((current) => ({ ...current, [roomId!]: {} }));
      setRoundDetails((current) => ({ ...current, [roomId!]: [] }));
      setCompactedTurns(0);
      void reliabilityQuery.refetch();
    },
    onSettled: () => void refresh("comments"),
    onError: (e) => setError(errorText(e)),
  });

  const updateSeat = useMutation({
    mutationFn: ({ seatId, patch }: { seatId: string; patch: { name?: string; persona?: string; model?: string; active?: boolean; role?: import("../api/council").CouncilSeatRole } }) =>
      councilApi.updateSeat(companyId, roomId!, seatId, patch),
    onSuccess: () => void refresh("seats"),
    onError: () => setError("Couldn’t update this seat. Try again."),
  });

  const removeSeat = useMutation({
    mutationFn: (seatId: string) => councilApi.removeSeat(companyId, roomId!, seatId),
    onSuccess: () => void refresh("seats"),
    onError: () => setError("Couldn’t remove this seat. Try again."),
  });

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const thread = threadScrollRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [comments.data?.length, roomId]);
  const abortRef = useRef<AbortController | null>(null);
  const [speakingOrder, setSpeakingOrder] = useState<CouncilRoundOrder>("seat");
  const [discussionStyle, setDiscussionStyle] = useState<CouncilRoundStyle>("collaborate");

  /** "ask" = answers, then the chosen discussion rounds and summary; the others are one-off rounds. */
  const ask = useMutation({
    mutationFn: async (mode: RoundMode) => {
      const runRoomId = roomId!;
      const controller = new AbortController();
      abortRef.current = controller;
      const panelSeed = Math.floor(Math.random() * 2147483647);
      const panel = panelSize >= 2 ? { size: panelSize, seed: panelSeed } : undefined;
      const run = (m: RoundMode, extra: { message?: string; images?: Array<{ mediaType: string; data: string }>; clarify?: boolean; ranking?: boolean; jury?: boolean; panel?: { size: number; seed: number }; stance?: boolean; dissent?: boolean; roundNumber?: number; maxRounds?: number } = {}) =>
        councilApi.runRound(
          companyId,
          runRoomId,
          {
            mode: m,
            ...(m === "ask" || m === "discuss" ? { order: speakingOrder } : {}),
            ...(m === "discuss" ? { style: discussionStyle } : {}),
            seatId: m === "summarize" ? summarySeatId || fastSeatId : undefined,
            // reasoning models spend part of the budget thinking; 1024 left them with empty answers
            maxOutputTokens: 3072,
            ...(panel && m !== "summarize" ? { panel } : {}),
            ...extra,
          },
          controller.signal,
        );
      const merged: CouncilSeatResult[] = [];
      const details: CouncilSeatResult[][] = [];
      let compacted = 0;
      const collect = (r: { results: CouncilSeatResult[]; compactedTurns?: number }) => {
        merged.push(...r.results);
        details.push(r.results);
        setRoundDetails((current) => ({ ...current, [runRoomId]: [...details] }));
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
        const asked = await run("ask", { message: text, images: pics, clarify, ranking: peerRanking, jury });
        collect(asked);
        if (asked.jury) setReviewNotice(`Jury on ${asked.jury.answerSeat}'s answer (${asked.jury.judges} judges): ${asked.jury.verdict.toUpperCase()} - pass ${asked.jury.counts.pass}, revise ${asked.jury.counts.revise}, fail ${asked.jury.counts.fail}`);
        if (asked.ranking) setReviewNotice(`Blind peer ranking (${asked.ranking.judges} judges): ${asked.ranking.order.map((row, i) => `${i + 1}. ${row.seatName}`).join("  ")}`);
        if (debate) {
          const untilAgreement = depth === "agree";
          const percents: number[] = [];
          for (let i = 1; i <= debate.rounds && !controller.signal.aborted; i++) {
            await refresh("comments");
            begin(`Discussion turn ${i} of ${debate.rounds}: vendors read each other…`);
            const round = await run("discuss", { message: debate.focus, ...(untilAgreement ? { stance: true, dissent: true, roundNumber: i, maxRounds: debate.rounds } : {}) });
            collect(round);
            if (round.dissent) setReviewNotice(round.dissent.strength === "none" ? "Dissent check: no real objection to the agreed position." : `Dissent check (${round.dissent.strength}): ${round.dissent.argument}`);
            if (!round.agreement) continue;
            setAgreements((current) => ({ ...current, [runRoomId]: { agreement: round.agreement!, round: i } }));
            percents.push(round.agreement.percent);
            const last = percents.at(-1)!;
            const prev = percents.at(-2);
            if (untilAgreement && (round.agreement.reached || (prev !== undefined && Math.abs(last - prev) <= 3))) break;
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
      return { roomId: runRoomId, results: merged };
    },
    onMutate: () => {
      setError(null);
      setStoppedNote(false);
      setRunning(true);
      // fold the vendor cards so the live conversation gets the screen
      setCardsOpen(false);
    },
    onSuccess: ({ roomId: runRoomId, results }) => {
      if (runRoomId !== roomId) return;
      setLastResults((current) => ({ ...current, [runRoomId]: Object.fromEntries(results.map((r) => [r.seatId, r])) }));
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
      void reliabilityQuery.refetch();
    },
  });

  const stopRound = async () => {
    if (!roomId) return;
    try {
      await councilApi.stopRound(companyId, roomId);
      abortRef.current?.abort();
      setStoppedNote(true);
      void reliabilityQuery.refetch();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!selectedCompanyId) return <EmptyState icon={Users} message="Select an organization to use Council." />;

  const canSend = !ask.isPending && !!message.trim() && activeSeats.length > 0;
  const room = rooms.data?.find((r) => r.id === roomId);
  const seatById = new Map(allSeats.map((s) => [`${SEAT_AUTHOR_PREFIX}${s.id}`, s]));
  const latestRound = roundDetails[roomId ?? ""]?.at(-1) ?? [];
  const roleLabel = (role: CouncilSeat["role"]) => role === "none" ? "Participant" : role === "moderator" ? "Orchestrator" : role[0].toUpperCase() + role.slice(1);
  const latestUserMessage = [...(comments.data ?? [])].reverse().find((c) => !c.authorUserId?.startsWith(SEAT_AUTHOR_PREFIX));
  const finalVendorReply = [...(comments.data ?? [])].reverse().find((c) => c.authorUserId?.startsWith(SEAT_AUTHOR_PREFIX));
  const requestedDocumentExport = DOCUMENT_EXPORT_REQUEST.test(latestUserMessage?.body ?? "") ? latestUserMessage?.body ?? "" : "";
  const showDocumentExportCta = !running && !!requestedDocumentExport && !!finalVendorReply;
  const requestedFormats = {
    pptx: /power ?point|pptx|slides?|deck/i.test(requestedDocumentExport),
    docx: /word doc|docx|word file/i.test(requestedDocumentExport),
  };

  return (
    <div data-task-chat-shell className="council-shell flex h-(--sz-100dvh) min-h-0 flex-col gap-3 overflow-hidden pb-(--tc-composer-visible-nav-offset) md:pb-0">
      <div className="council-header flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 basis-full items-center gap-3 sm:flex-1 sm:basis-0">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40"><MessagesSquare className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-tight">Multi-Vendor Council Chat</h1>
            <p className="truncate text-xs text-muted-foreground" title="Post a challenge; vendors debate and reconcile into one vision.">Post a challenge; vendors debate and reconcile into one vision.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          <div className="relative">
            <Button ref={settingsTriggerRef} type="button" variant="outline" size="sm" aria-label="Room settings" aria-expanded={settingsOpen} aria-controls="council-room-settings" onClick={() => setSettingsOpen((v) => !v)}>
              <Settings2 /> Settings {brief.trim() || requireApproval ? <span aria-label="Settings need attention" className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
            </Button>
            {settingsOpen ? <div id="council-room-settings" role="dialog" aria-label="Room settings" className="council-settings-panel fixed inset-x-2 bottom-2 z-40 max-h-screen overflow-y-auto rounded-xl border bg-popover p-4 shadow-2xl md:absolute md:inset-x-auto md:right-0 md:top-full md:bottom-auto md:mt-2 md:w-96">
              <div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-semibold">Room settings</h2><p className="text-xs text-muted-foreground">Optional controls for this war room.</p></div><Button type="button" variant="ghost" size="sm" aria-label="Close room settings" onClick={() => { setSettingsOpen(false); settingsTriggerRef.current?.focus(); }}><X /></Button></div>
              <div className="space-y-4 text-sm">
                <section className="space-y-2"><h3 className="font-semibold">How the council answers</h3><div className="flex flex-wrap gap-2"><Toggle label="Plan first" on={planFirst} onClick={() => setPlanFirst((v) => !v)} title="Instead of everyone answering, the chair plans the steps right away and the seats carry them out; a one-page summary lands in the chat" /><label className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs font-medium text-muted-foreground" title="Only this many vendors answer, picked at random from different connections, each with its own angle">Random panel<select aria-label="Random panel" className="h-7 rounded-md border bg-background px-1 text-xs text-foreground" value={panelSize} onChange={(e) => setPanelSize(Number(e.target.value))}><option value={0}>Everyone</option>{[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} seats</option>)}</select></label><Toggle label="Jury" on={jury} onClick={() => setJury((v) => !v)} title="After the answers, the other vendors vote pass, revise or fail on the best answer" /><Toggle label="Peer ranking" on={peerRanking} onClick={() => setPeerRanking((v) => !v)} title="After the answers, the vendors rank each other's answers without knowing who wrote them (needs 3 or more answers)" /><Toggle label="Draft tasks" on={workTasks} onClick={() => setWorkTasks((v) => !v)} title="When the work finishes, each step becomes a draft task (backlog) under this room for you to approve" /><Toggle label="Clarify" on={clarify} onClick={() => setClarify((v) => !v)} title="Lets a vendor ask another vendor one question before answering" /><Toggle label="Summary" on={autoSummary} onClick={() => setAutoSummary((v) => !v)} title="Adds a concise one-page summary after the vendors answer" /><label className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs font-medium text-muted-foreground">Rounds<select aria-label="Rounds" className="h-7 rounded-md border bg-background px-1 text-xs text-foreground" value={discussion ? depth : "off"} onChange={(e) => e.target.value === "off" ? setDiscussion(false) : (setDiscussion(true), setDepth(e.target.value as Depth))}><option value="off">No debate</option>{(Object.keys(DEPTHS) as Depth[]).map((d) => <option key={d} value={d}>{DEPTHS[d].label}</option>)}</select></label><label className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs font-medium text-muted-foreground">Speaking order<select aria-label="Speaking order" className="h-7 rounded-md border bg-background px-1 text-xs text-foreground" value={speakingOrder} onChange={(e) => setSpeakingOrder(e.target.value as CouncilRoundOrder)}><option value="seat">Seat order</option><option value="random">Random each round</option><option value="reverse">Reverse</option></select></label><label className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs font-medium text-muted-foreground">Discussion style<select aria-label="Discussion style" className="h-7 rounded-md border bg-background px-1 text-xs text-foreground" value={discussionStyle} onChange={(e) => setDiscussionStyle(e.target.value as CouncilRoundStyle)}><option value="collaborate">Collaborate</option><option value="challenge">Challenge each other</option></select></label></div></section>
                <section className="space-y-2"><h3 className="font-semibold">Room</h3><div className="flex flex-wrap gap-2"><button type="button" className="rounded-md border px-2 py-1" onClick={() => setBriefOpen((v) => !v)}>Brief</button><button type="button" className="rounded-md border px-2 py-1" onClick={() => setArtifactsOpen((v) => !v)}>Artifacts</button><details className="relative rounded-md border"><summary className="cursor-pointer list-none px-2 py-1">Reliability</summary><div className="absolute right-0 z-10 mt-1 w-80 max-w-full rounded-lg border bg-popover p-3 shadow-lg">{reliabilityQuery.isLoading ? <p className="text-muted-foreground">Loading reply history…</p> : reliabilityQuery.isError ? <p className="text-destructive">Reliability is unavailable.</p> : reliabilityQuery.data ? <p className="text-muted-foreground">Based on {reliabilityQuery.data.totals.replies} replies.</p> : null}</div></details><Toggle label="Ask before downloading exports" on={requireApproval} onClick={() => roomId && saveExportSetting.mutate({ targetRoomId: roomId, value: !requireApproval })} /></div></section>
                {roomId ? <section className="space-y-2"><LinkedTasksPanel roomId={roomId} companyId={companyId} onAskInRoom={(text) => setMessage(text)} /></section> : null}
                <section className="space-y-2"><h3 className="font-semibold">Usage and cost</h3><p className="text-xs text-muted-foreground">Every vendor call is recorded in Paperclip usage.</p><Link to="/costs" className="inline-flex rounded-md border px-2 py-1 text-xs hover:bg-accent">Open usage and costs</Link></section>
                <CouncilAgentPanel roomId={roomId ?? undefined} seats={allSeats} onSeatAdded={() => void refresh("seats")} />
                <section className="space-y-2"><h3 className="font-semibold">Vendors</h3><p className="text-xs text-muted-foreground">If the agent orchestrator fails, a model seat takes over.</p><div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setAdvancedMode((v) => !v)}>{advancedMode ? "Hide vendor settings" : "Show vendor settings"}</Button><Button type="button" variant="outline" size="sm" onClick={() => setParticipantsOpen((v) => !v)}><Users /> Participants</Button><span className="text-xs text-muted-foreground">{activeSeats.length} active</span></div>{allSeats.filter((seat) => seat.kind === "agent").map((seat) => <AgentSeatSettings key={seat.id} seat={seat} onUpdate={(patch) => updateSeat.mutate({ seatId: seat.id, patch })} onRemove={() => removeSeat.mutate(seat.id)} />)}</section>
              </div>
            </div> : null}
          </div>
          <div className="relative">
            <Button ref={moreTriggerRef} type="button" variant="outline" size="sm" aria-expanded={moreOpen} aria-controls="council-more-actions" onClick={() => setMoreOpen((v) => !v)}><MoreHorizontal /> More</Button>
            {moreOpen ? <div id="council-more-actions" className="absolute right-0 z-20 mt-1 flex min-w-44 flex-col rounded-lg border bg-popover p-1 shadow-lg">
              <Button variant="ghost" size="sm" className="justify-start sm:hidden" onClick={() => setClarify((v) => !v)}>Clarify <span className="ml-auto text-xs text-muted-foreground">{clarify ? "On" : "Off"}</span></Button>
              <Button variant="ghost" size="sm" className="justify-start sm:hidden" onClick={() => setAutoSummary((v) => !v)}>Summary <span className="ml-auto text-xs text-muted-foreground">{autoSummary ? "On" : "Off"}</span></Button>
              <label className="flex items-center gap-2 px-2 py-1.5 text-sm sm:hidden"><span>Rounds</span><select className="ml-auto h-7 rounded-md border bg-background px-1 text-xs" value={discussion ? depth : "off"} onChange={(e) => { if (e.target.value === "off") setDiscussion(false); else { setDiscussion(true); setDepth(e.target.value as Depth); } }}><option value="off">No debate</option>{(Object.keys(DEPTHS) as Depth[]).map((d) => <option key={d} value={d}>{DEPTHS[d].label}</option>)}</select></label>
              <Button variant="ghost" size="sm" className="justify-start" disabled={!roomId || setArchived.isPending || running} title={running ? "Stop the running round first" : undefined} aria-label={running ? "Archive Thread unavailable while a round is running" : "Archive Thread"} onClick={() => roomId && setArchived.mutate({ id: roomId, on: true })}><Archive /> Archive Thread</Button>
              <Button variant="ghost" size="sm" className="justify-start text-destructive" disabled={!roomId || !room || running} title={running ? "Stop the running round first" : undefined} aria-label={running ? "Delete Thread unavailable while a round is running" : "Delete Thread"} onClick={() => { if (room && window.confirm(`Delete the war room "${room.title}" and all its messages?`)) deleteRoom.mutate(room.id); }}><Trash2 /> Delete Thread</Button>
              <Button variant="ghost" size="sm" className="justify-start" onClick={() => { setShowArchives((v) => !v); setMoreOpen(false); }}>Archives <span className="rounded-full bg-accent px-1.5 text-xs">{archived.data?.length ?? 0}</span></Button>
              <Button variant="ghost" size="sm" className="justify-start" disabled={!roomId || !comments.data?.length || clearChat.isPending || running} title={running ? "Stop the running round first" : undefined} aria-label={running ? "Clear Chat unavailable while a round is running" : "Clear Chat"} onClick={() => { if (window.confirm("Clear every message in this war room? The vendors stay.")) clearChat.mutate(); }}>Clear Chat</Button>
            </div> : null}
          </div>
          <details className="hidden">
            <summary className="cursor-pointer list-none px-2 py-1.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Reliability</summary>
            <div className="absolute right-0 z-20 mt-1 w-80 max-w-full rounded-lg border bg-popover p-3 shadow-lg">
              {reliabilityQuery.isLoading ? <p className="text-muted-foreground">Loading reply history…</p> : reliabilityQuery.isError ? <p className="text-destructive">Reliability is unavailable.</p> : reliabilityQuery.data ? <>
                <table className="w-full text-left"><caption className="sr-only">Council reliability by seat</caption><thead><tr className="border-b text-muted-foreground"><th className="py-1 pr-2 font-medium">Seat</th><th className="py-1 pr-2 font-medium">Replies</th><th className="py-1 pr-2 font-medium">Avg time</th><th className="py-1 font-medium">Used backup</th></tr></thead><tbody>
                  {reliabilityQuery.data.seats.map((seat) => <tr key={seat.seatId} className="border-b last:border-0"><th scope="row" className="max-w-32 truncate py-1.5 pr-2 font-medium">{seat.seatName}</th><td className="py-1.5 pr-2">{seat.replies}</td><td className="py-1.5 pr-2">{seat.averageLatencyMs == null ? "—" : `${(seat.averageLatencyMs / 1000).toFixed(1)}s`}</td><td className="py-1.5">{seat.fallbackRate == null ? "—" : `${Math.round(seat.fallbackRate * 100)}%`}</td></tr>)}
                  <tr className="font-semibold"><th scope="row" className="py-1.5 pr-2">Total</th><td className="py-1.5 pr-2">{reliabilityQuery.data.totals.replies}</td><td className="py-1.5 pr-2">{reliabilityQuery.data.totals.averageLatencyMs == null ? "—" : `${(reliabilityQuery.data.totals.averageLatencyMs / 1000).toFixed(1)}s`}</td><td className="py-1.5">{reliabilityQuery.data.totals.fallbackRate == null ? "—" : `${Math.round(reliabilityQuery.data.totals.fallbackRate * 100)}%`}</td></tr>
                </tbody></table>
                <p className="mt-2 text-muted-foreground">Based on {reliabilityQuery.data.totals.replies} replies; small samples are not reliable</p>
                <p className="mt-1 text-muted-foreground">Run details are only available for this session when older replies have no saved details.</p>
              </> : null}
            </div>
          </details>
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

      <div className="flex min-w-0 items-center gap-2 rounded-lg border p-2">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">War rooms</span>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto overscroll-x-contain">
          <QueryState label="rooms" loading={rooms.isLoading} error={rooms.isError} onRetry={() => void rooms.refetch()} />
          {(rooms.data ?? []).map((r) => (
            <button
              key={r.id}
              disabled={running}
              onClick={() => {
                setRoomId(r.id);
                setLastResults((current) => ({ ...current, [r.id]: {} }));
                setRoundDetails((current) => ({ ...current, [r.id]: [] }));
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
            onClick={() => { setCreating(true); applyTemplate(DEFAULT_COUNCIL_TEMPLATE_ID); }}
            className="shrink-0 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground hover:bg-accent/50"
          >
            + New
          </button>
        </div>
      </div>

      {creating ? (
        <form
          className="min-w-0 shrink-0 rounded-lg border p-3 sm:p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (newTitle.trim()) createRoom.mutate();
          }}
        >
          <div className="flex items-center gap-2">
            <Input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Room title" className="h-8 min-w-0 flex-1" aria-label="Room title" />
            <Button type="submit" size="sm" disabled={createRoom.isPending || !newTitle.trim()}>{createRoom.isPending ? "Creating…" : "Create"}</Button>
            <Button type="button" size="sm" variant="ghost" aria-label="Cancel new war room" onClick={() => setCreating(false)}><X /></Button>
          </div>
          <div className="mt-3">
            <CouncilTemplates selected={selectedTemplate} seatCount={connectionOptions.filter((conn) => defaultsFor(conn.name)?.auto).length} onSelect={applyTemplate} />
          </div>
          {createRoom.isError ? <p role="alert" className="mt-2 text-xs text-destructive">Couldn’t create this room. {errorText(createRoom.error)}</p> : null}
        </form>
      ) : null}

      {!roomId && rooms.isLoading ? (
        <QueryState label="rooms" loading error={false} onRetry={() => void rooms.refetch()} />
      ) : !roomId && rooms.isError ? (
        <QueryState label="rooms" loading={false} error onRetry={() => void rooms.refetch()} />
      ) : !roomId ? (
        <EmptyState icon={Users} message="Create a war room to put several AI models on one question." />
      ) : (
        <>
          <QueryState label="connections" loading={connections.isLoading} error={connections.isError} onRetry={() => void connections.refetch()} />
          <QueryState label="seats" loading={seats.isLoading} error={seats.isError} onRetry={() => void seats.refetch()} />
          <div className={advancedMode ? "flex items-center justify-between text-xs" : "hidden"}>
            <span className="font-semibold uppercase tracking-wide text-muted-foreground">
              ● Select participating seats <span className="council-vendor-helper font-normal normal-case">· click Active / Inactive to include a seat · selected seats respond concurrently</span>
            </span>
            <span className="flex items-center gap-2">
              <button type="button" onClick={() => setCardsOpen((v) => !v)} className="rounded-md border px-2 py-0.5 text-(length:--text-micro) hover:bg-accent">
                {cardsOpen ? "▴ Hide vendor settings" : "▾ Show vendor settings"}
              </button>
              <span className="rounded-full border px-2 py-0.5 text-(length:--text-nano) font-semibold uppercase tracking-wide text-primary">
                {activeSeats.length} participant{activeSeats.length === 1 ? "" : "s"} selected
              </span>
            </span>
          </div>
          {!cardsOpen ? (
          <div className="flex shrink-0 flex-wrap gap-2 overflow-x-auto md:flex-wrap">
              {[...connectionOptions.map((conn) => ({ connection: conn, seat: seatOf(conn.id) })), ...allSeats.filter((seat) => seat.kind === "agent").map((seat) => ({ connection: undefined, seat }))].map(({ connection: conn, seat }) => {
                const isAgent = seat?.kind === "agent";
                const color = seat ? seatColor(seat.id) : colorOfConnection(conn!.id);
                const label = isAgent ? agentSeatLabel(seat!) : undefined;
                if (!conn && !seat) return null;
                return (
                  <button
                    key={seat?.id ?? `${conn!.id}:${conn!.grantId}`}
                    type="button"
                    disabled={!seat}
                    onClick={() => seat && updateSeat.mutate({ seatId: seat.id, patch: { active: !seat.active } })}
                    className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs ${seat?.active ? "" : "opacity-50"}`}
                    style={{ borderColor: seat?.active ? color : undefined }}
                    title="Click to switch this vendor on or off"
                  >
                    <b>{seat?.name ?? conn!.name}</b>
                    {label ? <span className="rounded-full bg-accent px-1.5 py-0.5 text-(length:--text-nano) text-muted-foreground">{label}</span> : null}
                    {seat?.role === "moderator" ? <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-(length:--text-nano) text-primary">Orchestrator</span> : null}
                    {advancedMode ? <span className={`h-2 w-2 rounded-full ${running && seat?.active ? "animate-pulse bg-primary" : seat?.active ? "bg-emerald-500" : "bg-muted-foreground/40"}`} title={running && seat?.active ? "Working" : seat?.active ? "Ready" : "Inactive"} /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
          <details open={participantsOpen} onToggle={(event) => setParticipantsOpen(event.currentTarget.open)} className={advancedMode ? "council-participants shrink-0 rounded-lg border bg-muted/10" : "hidden"}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-semibold [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2"><Users className="h-3.5 w-3.5 text-muted-foreground" /> Participants <span className="font-normal text-muted-foreground">{activeSeats.length} active</span></span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <span>{participantsOpen ? "Hide" : "Show"}</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${participantsOpen ? "rotate-180" : ""}`} />
              </span>
            </summary>
            <div className="flex flex-wrap gap-1 border-t px-2 py-2">
              {activeSeats.map((seat) => {
                const result = latestRound.find((candidate) => candidate.seatId === seat.id) ?? lastResults[roomId ?? ""]?.[seat.id];
                const status = running && !result ? "working…" : result ? (result.status === "ok" ? "answered" : result.status === "blocked" ? "skipped" : result.status === "cancelled" ? "stopped" : "failed") : "waiting";
                const latency = result?.latencyMs ?? result?.durationMs;
                const statusTone = status === "answered" ? "text-emerald-600" : status === "failed" ? "text-destructive" : status === "working…" ? "text-primary" : "text-muted-foreground";
                return (
                  <div key={seat.id} className="flex min-w-0 items-center gap-2 rounded-md border bg-background/60 px-2 py-1">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-(length:--text-nano)" style={{ borderColor: seatColor(seat.id), color: seatColor(seat.id) }}>
                      {seat.kind === "agent" ? agentSeatLabel(seat) : vendorIcon(vendorOf(seat))}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5 text-xs">
                        <span className="truncate font-medium" title={seat.name}>{seat.name}</span>
                        <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-(length:--text-nano) text-muted-foreground">{roleLabel(seat.role)}</span>
                      </div>
                      <div className="truncate text-(length:--text-nano) text-muted-foreground" title={`${vendorOf(seat)} · ${seat.model}`}>{vendorOf(seat)}</div>
                    </div>
                    <div className={`flex shrink-0 flex-col items-end gap-0.5 text-(length:--text-nano) ${statusTone}`}>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 font-medium leading-tight">{status}</span>
                      <span className="text-muted-foreground">{latency != null ? `${(latency / 1000).toFixed(1)}s` : "—"}</span>
                    </div>
                  </div>
                );
              })}
              {!activeSeats.length ? <p className="px-1 text-xs text-muted-foreground">No active participants.</p> : null}
            </div>
          </details>
          <div className={`${advancedMode && cardsOpen ? "grid" : "hidden"} shrink-0 gap-3 pb-2 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]`}>
            {[
              ...allSeats.map((seat) => ({ conn: connectionOptions.find((candidate) => candidate.id === seat.connectionId), seat })),
              ...connectionOptions.filter((conn) => !allSeats.some((seat) => seat.connectionId === conn.id)).map((conn) => ({ conn, seat: undefined })),
            ].map(({ conn, seat }) => {
              if (!conn) return null;
              const modelIndex = connectionOptions.findIndex((candidate) => candidate.id === conn.id && candidate.grantId === conn.grantId);
              const d = defaultsFor(conn.name);
              return (
                <VendorSeatCard
                  key={seat ? seat.id : `${conn.id}:${conn.grantId}`}
                  vendor={conn.name}
                  color={colorOfConnection(conn.id)}
                  roomId={roomId!}
                  seat={seat}
                  draftDefaults={{ name: d?.name ?? conn.name.split(/\s+/)[0], model: d?.model ?? "", persona: d?.persona ?? "", role: "none" }}
                  models={modelLists[modelIndex]?.data ?? []}
                  modelsLoading={modelLists[modelIndex]?.isLoading}
                  result={seat ? lastResults[roomId ?? ""]?.[seat.id] : undefined}
                  running={running}
                  onActivate={(draft) => activateVendor.mutate({ conn, draft })}
                  onRemove={seat ? () => removeSeat.mutate(seat.id) : undefined}
                  onMention={seat ? () => addToMessage(mentionOf(seat)) : undefined}
                  onUpdate={(patch) => seat ? updateSeat.mutateAsync({ seatId: seat.id, patch }) : Promise.resolve()}
                />
              );
            })}
            {!connections.isLoading && !connections.isError && !connectionOptions.length ? <p className="text-sm text-muted-foreground">No AI connections yet. Add one in Settings.</p> : null}
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

          <div className="council-thread-shell flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className={advancedMode ? "shrink-0 rounded-lg border bg-muted/10 px-2 py-1.5" : "hidden"}>
            <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto text-xs">
              <span className="mr-1 shrink-0 font-semibold text-muted-foreground">Room tools</span>
              <button type="button" aria-expanded={briefOpen} onClick={() => setBriefOpen((v) => !v)} className="shrink-0 rounded-md border px-2 py-1 font-medium hover:bg-accent">
                Brief <span className="ml-1 rounded-full bg-muted px-1.5 text-(length:--text-nano)">{brief.trim() ? "set" : "empty"}</span>
              </button>
              <button type="button" aria-expanded={artifactsOpen} onClick={() => setArtifactsOpen((v) => !v)} className="shrink-0 rounded-md border px-2 py-1 font-medium hover:bg-accent">
                Artifacts <span className="ml-1 rounded-full bg-muted px-1.5 text-(length:--text-nano)">{artifactsQuery.data?.length ?? 0}</span>
              </button>
              <label className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground" title="Ask before downloading exports">
                <input type="checkbox" checked={requireApproval} onChange={(e) => roomId && saveExportSetting.mutate({ targetRoomId: roomId, value: e.target.checked })} disabled={!roomId || saveExportSetting.isPending} />
                <span className="council-export-label">Ask before downloading exports</span>
              </label>
            </div>
            {briefOpen ? <div id="council-brief" className="mt-2 border-t pt-2"><QueryState label="the brief" loading={briefQuery.isLoading} error={briefQuery.isError} onRetry={() => void briefQuery.refetch()} />{!briefQuery.isLoading && !briefQuery.isError ? <div className="flex gap-2"><Textarea value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={4000} rows={2} placeholder="Shared context for every vendor in this room…" className="min-h-0 flex-1" /><Button type="button" size="sm" onClick={() => roomId && saveBrief.mutate(roomId)} disabled={saveBrief.isPending || brief.length > 4000}>Save</Button></div> : null}</div> : null}
            {artifactsOpen ? <div id="council-artifacts" className="mt-2 space-y-2 border-t pt-2"><QueryState label="artifacts" loading={artifactsQuery.isLoading} error={artifactsQuery.isError} onRetry={() => void artifactsQuery.refetch()} />{!artifactsQuery.isLoading && !artifactsQuery.isError ? <>{artifactDraft ? <div className="flex flex-wrap items-center gap-2"><input aria-label="Artifact title" className="min-w-40 flex-1 rounded-md border bg-background px-2 py-1 text-xs" value={artifactDraft.title} onChange={(e) => setArtifactDraft({ ...artifactDraft, title: e.target.value })} /><Button type="button" size="sm" disabled={saveArtifact.isPending || !artifactDraft.title.trim()} onClick={() => { const slug = artifactDraft.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "draft"; saveArtifact.mutate({ companyId, roomId: roomId!, artifact: { key: `council-output-${slug}`, title: artifactDraft.title.trim(), markdown: artifactDraft.markdown } }); }}>Save artifact</Button></div> : null}<div className="flex flex-wrap gap-1">{(artifactsQuery.data ?? []).map((artifact) => <button key={artifact.key} type="button" className={`rounded-md border px-2 py-1 text-xs ${selectedArtifactKey === artifact.key ? "border-primary bg-accent" : "hover:bg-accent"}`} onClick={() => { setSelectedArtifactKey(artifact.key); setSelectedRevision(null); }}>{artifact.title ?? artifact.key} <span className="ml-1 rounded-full bg-muted px-1.5">v{artifact.latestRevisionNumber}</span></button>)}{!artifactsQuery.data?.length ? <span className="text-xs text-muted-foreground">Save a reply to create the first artifact.</span> : null}</div></> : null}{artifactQuery.isError ? <QueryState label="the artifact" loading={false} error onRetry={() => void artifactQuery.refetch()} /> : null}{artifactQuery.data ? <div className="border-t pt-2"><div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium"><span>{artifactQuery.data.title}</span><div className="flex items-center gap-2"><select aria-label="Artifact revision" className="h-7 rounded-md border bg-background px-1" value={selectedRevision ?? artifactQuery.data.latestRevisionNumber} onChange={(e) => setSelectedRevision(Number(e.target.value))}>{artifactQuery.data.revisions.map((item) => <option key={item.revisionNumber} value={item.revisionNumber}>v{item.revisionNumber}</option>)}</select>{reviewArtifact.isPending ? <Button type="button" size="sm" variant="destructive" aria-label="Stop the review" onClick={() => { reviewAbortRef.current?.abort(); void councilApi.stopRound(companyId, roomId!); }}>Stop</Button> : <Button type="button" size="sm" variant="outline" disabled={running} aria-label="Review and revise selected artifact" onClick={() => reviewArtifact.mutate({ companyId, roomId: roomId!, key: selectedArtifactKey! })}>{"Review & revise"}</Button>}</div></div><MarkdownBody className="max-h-32 overflow-y-auto text-sm">{artifactQuery.data.body}</MarkdownBody></div> : null}</div> : null}
          </div>
          <div ref={threadScrollRef} className="council-message-thread flex min-h-0 min-w-0 flex-1 basis-0 flex-col space-y-3 overflow-x-hidden overflow-y-auto rounded-md border p-3">
            <QueryState label="comments" loading={comments.isLoading} error={comments.isError} onRetry={() => void comments.refetch()} />
            {!comments.isLoading && !comments.isError && (comments.data ?? []).map((c) => {
              const seat = c.authorUserId ? seatById.get(c.authorUserId) : undefined;
              const seatAuthor = !!c.authorUserId?.startsWith(SEAT_AUTHOR_PREFIX);
              if (!seatAuthor) {
                return (
                  <div key={c.id} className="ml-auto min-w-0 max-w-(--council-message-max-width) rounded-2xl bg-indigo-600 px-4 py-2 text-white">
                    <MarkdownBody className="min-w-0 text-sm text-white [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{c.body}</MarkdownBody>
                    <div className="mt-1 text-right text-(length:--text-nano) opacity-70">{clock(c.createdAt)}</div>
                  </div>
                );
              }
              const color = seat ? seatColor(seat.id) : "var(--council-seat-color-fallback)";
              const name = seat?.name ?? "Seat";
              const decision = seat?.role === "moderator" ? parseCouncilDecisionRecord(c.body) : null;
              return (
                <div key={c.id} className="flex min-w-0 gap-2">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-(length:--text-micro) font-semibold"
                    style={{ borderColor: color, color }}
                  >
                    {name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1 rounded-lg bg-muted/50 p-3" style={{ borderLeft: `3px solid ${color}` }}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold">
                      <span>
                        {c.metadata?.councilReliability?.councilKind === "critique" ? <span className="mr-1 rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">Critique</span> : null}
                        {seat?.role === "moderator" ? <span className="mr-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-primary">Orchestrator</span> : null}@{name} • {seat ? vendorOf(seat) : "Vendor"}
                        <span className="sr-only">{seat ? ` (${seat.model})` : ""}</span>
                      </span>
                      <span className="font-normal text-muted-foreground">{clock(c.createdAt)}</span>
                    </div>
                    {decision ? (
                      <section aria-label="Council decision" className="space-y-3 rounded-md border border-border/70 bg-card p-3">
                        <div>
                          <h2 className="text-xs font-semibold text-muted-foreground">Recommendation</h2>
                          <MarkdownBody className="min-w-0 text-sm font-medium [overflow-wrap:anywhere] [&>*:first-child]:mt-1 [&>*:last-child]:mb-0">{decision.recommendation}</MarkdownBody>
                        </div>
                        <span className="inline-flex w-fit rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary" aria-label={`Confidence: ${decision.confidence}`}>Confidence: {decision.confidence}</span>
                        <div className="space-y-1">
                          {[["Where seats agree", decision.agreement], ["Disagreement / dissent", decision.dissent], ["Risks and unknowns", decision.risks]].map(([label, items]) => (
                            <details key={label as string} className="rounded-md border border-border/60 px-2 py-1.5">
                              <summary className="cursor-pointer text-xs font-medium">{label as string}</summary>
                              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted-foreground">{(items as string[]).map((item) => <li key={item}>{item}</li>)}</ul>
                            </details>
                          ))}
                        </div>
                        <div className="border-t border-border/60 pt-2">
                          <p className="text-xs font-semibold text-muted-foreground">Next question</p>
                          {roomId && roomIssueQuery.data?.identifier ? <CreateTaskFromDecisionButton roomId={roomId} roomIdentifier={roomIssueQuery.data.identifier} roomTitle={room?.title ?? "Council room"} decision={decision} /> : null}
                          <Button type="button" variant="outline" size="sm" className="mt-1 h-auto w-full flex-col items-start gap-0.5 text-left" onClick={() => setMessage(decision.nextQuestion)} aria-label={`Ask this question: ${decision.nextQuestion}`}>
                            <span className="font-semibold">Ask this question</span>
                            <span className="text-muted-foreground">{decision.nextQuestion}</span>
                          </Button>
                          {companyId && roomIssueQuery.data?.identifier && decision.actionItems.length > 0 ? (
                            <div className="mt-2">
                              <ActionItemsChecklist
                                companyId={companyId}
                                roomIdentifier={roomIssueQuery.data.identifier}
                                decision={decision}
                                existingTitles={(roomIssueQuery.data.relatedWork?.inbound ?? []).map(({ issue }) => issue.title)}
                              />
                            </div>
                          ) : null}
                        </div>
                      </section>
                    ) : <MarkdownBody className="min-w-0 text-sm [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{c.body}</MarkdownBody>}
                    <div className="mt-1 flex justify-end gap-2 text-(length:--text-nano) text-muted-foreground">
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-(length:--text-nano)" disabled={saveArtifact.isPending} onClick={() => {
                        if (!roomId) return;
                        setArtifactDraft({ markdown: c.body, title: `${name} output ${new Date(c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` });
                        setArtifactsOpen(true);
                      }}>Save as artifact</Button>
                      <select
                        aria-label="Save reply as"
                        className="h-6 rounded-md border bg-background px-1 text-(length:--text-nano) text-foreground"
                        value=""
                        disabled={!!exportingReply}
                        onChange={async (e) => {
                          const format = e.target.value as "md" | "txt" | "docx" | "pptx";
                          if (!format) return;
                          const exportKey = `${c.id}:${format}`;
                          if (requireApproval && !window.confirm("Export this reply?")) { e.currentTarget.value = ""; return; }
                          if (format === "md" || format === "txt") {
                            saveTextFile(`${room?.title ?? "council"}-${name}.${format}`, c.body);
                            return;
                          }
                          setExportingReply(exportKey);
                          try {
                            const exported = await councilApi.exportDocument(companyId, roomId!, format, room?.title ?? "Council reply", c.body, requireApproval, format === "pptx" ? consolidatePptx : false);
                            saveBlobFile(`${room?.title ?? "council"}-${name}.${format}`, exported.blob);
                            if (format === "pptx" && roomId) setLastExportNoteByRoom((notes) => ({ ...notes, [roomId]: exported.consolidated ? "Condensed into slides." : "Exported as-is." }));
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
                              if (requireApproval && !window.confirm("Export this reply?")) return;
                              setExportingReply(`${c.id}:pptx`);
                              try {
                                const exported = await councilApi.exportDocument(companyId, roomId!, "pptx", room?.title ?? "Council reply", c.body, requireApproval, consolidatePptx);
                                saveBlobFile(`${room?.title ?? "council"}.pptx`, exported.blob);
                                if (roomId) setLastExportNoteByRoom((notes) => ({ ...notes, [roomId]: exported.consolidated ? "Condensed into slides." : "Exported as-is." }));
                              } catch (err) {
                                setError(`Could not create the .pptx: ${errorText(err)}`);
                              } finally {
                                setExportingReply(null);
                              }
                            }}
                          >
                            {exportingReply === `${c.id}:pptx` ? <Loader2 className="animate-spin" /> : null} {exportingReply === `${c.id}:pptx` && consolidatePptx ? "Condensing…" : "Download PowerPoint"}
                          </Button>
                        ) : null}
                        {requestedFormats.pptx ? <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" aria-label="Condense into 3-4 slides first" checked={consolidatePptx} onChange={(event) => setConsolidatePptx(event.target.checked)} /> <span>Condense into 3-4 slides first <span className="text-(length:--text-nano)">(keeps the key facts and numbers)</span></span></label> : null}
                        {lastExportNote ? <span role="status" className="text-xs text-muted-foreground">{lastExportNote}</span> : null}
                        {requestedFormats.docx ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={!!exportingReply}
                            onClick={async () => {
                              if (requireApproval && !window.confirm("Export this reply?")) return;
                              setExportingReply(`${c.id}:docx`);
                              try {
                                saveBlobFile(`${room?.title ?? "council"}.docx`, (await councilApi.exportDocument(companyId, roomId!, "docx", room?.title ?? "Council reply", c.body, requireApproval, false)).blob);
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
            {workQuery.data && workQuery.data.status !== "idle" ? <CouncilWorkPanel steps={workQuery.data.steps} running={workQuery.data.status === "running"} /> : null}
            {roomId && agreements[roomId] ? <CouncilAgreementMeter agreement={agreements[roomId]!.agreement} round={agreements[roomId]!.round} /> : null}
            {(roundDetails[roomId ?? ""] ?? []).map((results, index) => (
              <details key={`round-details-${index}`} className="rounded-md border border-border/60 bg-muted/20 text-xs text-muted-foreground">
                <summary className="cursor-pointer px-2.5 py-1.5 font-medium hover:text-foreground" aria-label={`Show run details for round ${index + 1}`}>Run details · round {index + 1}</summary>
                <div className="overflow-x-auto border-t border-border/50">
                  <table className="w-full text-left">
                    <thead className="text-(length:--text-nano) text-muted-foreground"><tr className="border-b border-border/50"><th className="px-2.5 py-1.5 font-medium">Seat</th><th className="px-2.5 py-1.5 font-medium">Time</th><th className="px-2.5 py-1.5 font-medium">Tokens in</th><th className="px-2.5 py-1.5 font-medium">Tokens out</th><th className="px-2.5 py-1.5 font-medium">Model</th><th className="px-2.5 py-1.5 font-medium">Status</th></tr></thead>
                    <tbody className="divide-y divide-border/50">
                  {results.map((result, resultIndex) => {
                    const seat = allSeats.find((candidate) => candidate.id === result.seatId);
                    const status = result.status === "ok" ? "ok" : result.status === "blocked" ? "skipped" : result.status === "cancelled" ? "stopped" : "failed";
                    const statusLabel = result.status === "cancelled" ? "Stopped" : status;
                    return (
                      <tr key={`${result.seatId}-${resultIndex}`}><td className="px-2.5 py-1.5 font-medium text-foreground">{seat ? vendorOf(seat) : "Unknown vendor"}{result.orchestrator ? " (orchestrator)" : ""}</td><td className="px-2.5 py-1.5">{result.latencyMs == null ? "—" : `${(result.latencyMs / 1000).toFixed(1)}s`}</td><td className="px-2.5 py-1.5">{result.usage?.inputTokens ?? "—"}</td><td className="px-2.5 py-1.5">{result.usage?.outputTokens ?? "—"}</td><td className="max-w-40 truncate px-2.5 py-1.5" title={result.model}>{result.model ?? "—"}{result.fallbackUsed ? " (fallback)" : ""}</td><td className={status === "ok" ? "px-2.5 py-1.5 text-emerald-600" : status === "failed" ? "px-2.5 py-1.5 text-destructive" : "px-2.5 py-1.5"}>{statusLabel}{result.status === "cancelled" ? " — you stopped this round" : result.error ? ` — ${result.error.slice(0, 80)}` : ""}</td></tr>
                    );
                  })}
                    </tbody>
                  </table>
                  <div className="border-t border-border/50 px-2.5 py-1.5 font-medium text-foreground">Round total · wall time {(() => { const seatTime = Math.max(0, ...results.filter((result) => !result.orchestrator).map((result) => result.durationMs ?? 0)); const orchestratorTime = results.find((result) => result.orchestrator)?.durationMs ?? 0; return `${((seatTime + orchestratorTime) / 1000).toFixed(1)}s`; })()} · tokens {(() => { const total = results.reduce((sum, result) => sum + (result.usage?.totalTokens ?? 0), 0); return results.some((result) => result.usage) ? total : "—"; })()}</div>
                </div>
              </details>
            ))}
            {!comments.isLoading && !comments.isError && comments.data && !comments.data.length ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{activeSeats.length ? "Ask the council one question, or start from an example." : "Switch at least one vendor to Active, then ask."}</p>
                {activeSeats.length ? <div className="grid shrink-0 gap-2 md:grid-cols-3">{QUICK_PROMPTS.map((q) => <button key={q.title} type="button" onClick={() => setMessage(q.text)} className="rounded-lg border p-2 text-left hover:bg-accent/50"><div className="text-sm font-medium">{q.title}</div><div className="text-xs text-muted-foreground">{q.hint}</div></button>)}</div> : null}
              </div>
            ) : null}
            <div ref={threadEndRef} />
          </div>

          {reviewNotice ? <p role="status" className="text-sm text-emerald-600">{reviewNotice}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {stoppedNote ? <p className="text-sm text-muted-foreground">Stopped. Replies that already arrived are kept.</p> : null}
          {compactedTurns > 0 ? (
            <p className="text-xs text-emerald-600">
              Token saver: {compactedTurns} older turn{compactedTurns > 1 ? "s were" : " was"} sent to the vendors as short digests. The full text stays in this thread.
            </p>
          ) : null}

          {!creating ? <form
            className="mobile-nav-composer relative z-20 flex shrink-0 flex-col gap-2 rounded-xl border bg-background p-2 shadow-lg md:sticky md:bottom-(--tc-composer-bottom) md:mb-0"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canSend) return;
              if (planFirst && workStatus !== "running") {
                startWork.mutate({ goal: message.trim(), postGoal: true, ...(workTasks ? { createTasks: true } : {}) });
                setMessage("");
                return;
              }
              ask.mutate("ask");
            }}
          >
            {suggestion ? <p className="px-1 text-xs text-muted-foreground" data-testid="council-mode-hint">Suggested: <span className="font-medium text-foreground">{suggestion.kind.replace("-", " ")}</span> · {suggestion.reason}{suggestion.workSession && !planFirst ? <button type="button" className="ml-2 underline" onClick={() => setPlanFirst(true)}>Plan first</button> : null}</p> : null}
            <div className="flex items-end gap-2">
            <Textarea
              value={message}
              aria-label="Message the council"
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Ask the council… type detailed instructions, paste code, or tag ${activeSeats.slice(0, 3).map(mentionOf).join(", ") || "a vendor"}`}
              rows={1}
              onInput={(e) => { e.currentTarget.style.height = "auto"; e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 144)}px`; }}
              className="council-message-input field-sizing-fixed min-h-0 min-w-0 flex-1 resize-none border-0 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            {ask.isPending ? <><Button type="button" variant="destructive" aria-label="Stop the round" onClick={() => void stopRound()}><Square /> Stop</Button><Button type="submit" disabled><Send /> Send</Button></> : <><Button type="submit" disabled={!canSend}><Send /> Send</Button>{hasAnswers && workStatus !== "running" ? <Button type="button" variant="outline" disabled={startWork.isPending} title="The chair plans the steps, the seats carry them out, and a one-page summary lands in the chat" onClick={() => { const goal = (message.trim() || latestUserMessage?.body || "").trim(); if (!goal) return; const decision = [...(comments.data ?? [])].reverse().find((c) => c.authorUserId?.startsWith(SEAT_AUTHOR_PREFIX))?.body; startWork.mutate({ goal, ...(decision ? { decision: decision.slice(0, 8000) } : {}), ...(workTasks ? { createTasks: true } : {}) }); }}>Start the work</Button> : null}{workStatus === "running" ? <Button type="button" variant="destructive" onClick={() => void councilApi.stopWork(companyId, roomId!).then(() => workQuery.refetch())}><Square /> Stop work</Button> : null}</>}
            </div>
            {!comments.isLoading && !comments.isError && !comments.data?.length ? <p className="px-2 text-xs text-muted-foreground">Tip: ask for a PowerPoint or Word file and a download button appears.</p> : null}
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
            <div className="relative flex flex-wrap items-center gap-2 text-xs">
              <Button ref={optionsTriggerRef} type="button" variant="outline" size="sm" className="council-options-trigger" onClick={() => setOptionsOpen((v) => !v)} aria-label="Message options" title="Message options" aria-expanded={optionsOpen} aria-controls="council-options-popover"><Settings2 /><span>Options</span></Button>
              {optionsOpen ? <div id="council-options-popover" className="council-options-popover absolute bottom-full left-0 z-20 mb-2 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover p-2 shadow-lg">
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
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">Response options</span>
                  <button type="button" aria-pressed={discussion} onClick={() => setDiscussion((v) => !v)} className={`rounded-full border px-3 py-1 font-medium ${discussion ? "border-primary bg-accent" : "text-muted-foreground"}`} title="After the first answers, vendors read each other and debate"><MessagesSquare className="mr-1 inline h-3.5 w-3.5" /> Discussion: {discussion ? "ON" : "OFF"}</button>
                  <select className="h-8 rounded-md border bg-background px-2 disabled:opacity-50" aria-label="Discussion depth" disabled={!discussion} value={depth} onChange={(e) => setDepth(e.target.value as Depth)}>{(Object.keys(DEPTHS) as Depth[]).map((d) => <option key={d} value={d}>{DEPTHS[d].label}</option>)}</select>
                  <select className="h-8 rounded-md border bg-background px-2" aria-label="Summary by" value={summarySeatId} onChange={(e) => setSummarySeatId(e.target.value)}><option value="">Summary by (auto: fast vendor)</option>{activeSeats.map((s) => <option key={s.id} value={s.id}>Summary by {s.name}</option>)}</select>
                  {roomId ? <CouncilEstimate roomId={roomId} mode="ask" /> : null}
                  <Button type="button" variant="outline" size="sm" disabled={ask.isPending || !hasAnswers} onClick={() => ask.mutate("summarize")}>Summary</Button>
                  <Button type="button" variant="outline" size="sm" disabled={ask.isPending || activeSeats.length < 2 || !hasAnswers} onClick={() => ask.mutate("discuss")}>Discuss now</Button>
                </div>
              </div>
              </div> : null}</div>
          </form> : null}
          {!creating ? <p className="text-xs text-muted-foreground">
            Enter sends, Shift+Enter adds a line. Tag one vendor with its @name, or <code>@all</code> for everyone.
          </p> : null}
          </div>
        </>
      )}
    </div>
  );
}
