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

/** One-click starting council; a preset is skipped when its connection is not set up. */
const DEFAULT_SEATS = [
  { name: "Qwen 4B (local)", connection: "Ollama", model: "qwen3.5:4b", thinkingOff: true, vision: true, fallback: "gemini-3.5-flash-lite" },
  { name: "GLM 4.7 Flash (local)", connection: "Ollama", model: "glm-4.7-flash" },
  { name: "Gemini 3.5 Flash-Lite", connection: "Gemini", model: "gemini-3.5-flash-lite", vision: true },
  { name: "Gemini 3.6 Flash", connection: "Gemini", model: "gemini-3.6-flash", vision: true },
  { name: "Groq gpt-oss-120b", connection: "Groq", model: "openai/gpt-oss-120b" },
  { name: "NVIDIA Nemotron", connection: "NVIDIA", model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" },
] as const;

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

function SeatCard({
  seat,
  result,
  onRemove,
  onMention,
  color,
}: {
  color: string;
  seat: CouncilSeat;
  result?: CouncilSeatResult;
  onRemove: () => void;
  onMention: () => void;
}) {
  return (
    <div className="flex min-w-[11rem] flex-col gap-1 rounded-md border bg-card px-3 py-2 text-sm" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" title="Click to @mention this seat" onClick={onMention} className="text-left font-medium hover:underline">
          {seat.name}
        </button>
        <button aria-label={`Remove ${seat.name}`} onClick={onRemove} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <span className="text-xs text-muted-foreground">{seat.model}</span>
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
  const [message, setMessage] = useState("");
  const [lastResults, setLastResults] = useState<Record<string, CouncilSeatResult>>({});
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [summarySeatId, setSummarySeatId] = useState("");
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
  const seatColor = (seatId: string) => {
    const i = (seats.data ?? []).findIndex((s) => s.id === seatId);
    return SEAT_COLORS[(i < 0 ? 0 : i) % SEAT_COLORS.length];
  };
  const seatNames = new Map((seats.data ?? []).map((s) => [`${SEAT_AUTHOR_PREFIX}${s.id}`, s.name]));
  const refresh = (what: "rooms" | "seats" | "comments") =>
    queryClient.invalidateQueries({ queryKey: what === "rooms" ? ["council", companyId, "rooms"] : ["council", companyId, roomId, what] });

  const createRoom = useMutation({
    mutationFn: () => councilApi.createRoom(companyId, newTitle.trim()),
    onSuccess: (room) => {
      setNewTitle("");
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
  const ask = useMutation({
    mutationFn: (mode: "ask" | "discuss" | "summarize") => {
      const controller = new AbortController();
      abortRef.current = controller;
      return councilApi.runRound(
        companyId,
        roomId!,
        {
          message: message.trim(),
          mode,
          seatId: mode === "summarize" ? summarySeatId || undefined : undefined,
          images: mode === "ask" ? images.map(({ mediaType, data }) => ({ mediaType, data })) : undefined,
        },
        controller.signal,
      );
    },
    onMutate: () => setError(null),
    onSuccess: (round) => {
      setMessage("");
      setImages([]);
      setLastResults(Object.fromEntries(round.results.map((r) => [r.seatId, r])));
      void refresh("comments");
    },
    onError: (e) => {
      if (!abortRef.current?.signal.aborted) setError(errorText(e));
      void refresh("comments");
    },
  });

  if (!selectedCompanyId) return <EmptyState icon={Users} message="Select an organization to use Council." />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 md:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-2 md:w-60">
        <h2 className="text-sm font-semibold">War rooms</h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newTitle.trim()) createRoom.mutate();
          }}
        >
          <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New room title" />
          <Button type="submit" size="icon" variant="outline" aria-label="Create room" disabled={createRoom.isPending}>
            <Plus />
          </Button>
        </form>
        <div className="flex flex-col gap-1">
          {(rooms.data ?? []).map((room) => (
            <div key={room.id} className={`group flex items-center rounded-md ${room.id === roomId ? "bg-accent font-medium" : "hover:bg-accent/50"}`}>
              <button
                onClick={() => {
                  setRoomId(room.id);
                  setLastResults({});
                }}
                className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
              >
                {room.title}
              </button>
              <button
                aria-label={`Delete ${room.title}`}
                title="Delete room"
                className="mr-2 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                onClick={() => {
                  if (window.confirm(`Delete the war room "${room.title}" and all its messages?`)) deleteRoom.mutate(room.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {rooms.data && !rooms.data.length ? <p className="text-xs text-muted-foreground">No rooms yet. Create one above.</p> : null}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {!roomId ? (
          <EmptyState icon={Users} message="Create a war room to put several AI models on one question." />
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-2">
              {(seats.data ?? []).map((seat) => (
                <SeatCard
                  key={seat.id}
                  seat={seat}
                  result={lastResults[seat.id]}
                  color={seatColor(seat.id)}
                  onRemove={() => removeSeat.mutate(seat.id)}
                  onMention={() => setMessage((m) => `${m}${m && !m.endsWith(" ") ? " " : ""}@${seat.name.split(/\s+/)[0]} `)}
                />
              ))}
              <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)}>
                <Plus /> Add seat
              </Button>
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
                <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
                  <p>{(seats.data?.length ?? 0) ? "Ask the whole council one question." : "This room has no seats yet."}</p>
                  {(seats.data?.length ?? 0) === 0 ? (
                    <Button size="sm" onClick={() => addDefaults.mutate()} disabled={addDefaults.isPending}>
                      <Sparkles /> {addDefaults.isPending ? "Adding seats…" : "Add the default council"}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {ask.isPending ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Seats are answering…
                </p>
              ) : null}
              <div ref={threadEndRef} />
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 hover:bg-accent">
                <ImagePlus className="h-3.5 w-3.5" /> Attach image
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
              {images.map((img, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                  {img.name}
                  <button type="button" aria-label={`Remove ${img.name}`} onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {images.length ? <span>Only seats marked "vision" can see them.</span> : null}
            </div>
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (message.trim() && (seats.data?.length ?? 0) > 0) ask.mutate("ask");
              }}
            >
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Ask every seat…"
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
                }}
              />
              <div className="flex flex-col gap-2">
                <Button type="submit" disabled={ask.isPending || !message.trim() || !(seats.data?.length ?? 0)}>
                  <Send /> Ask all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  title="Every seat reads the others' answers and reacts. Your note above is optional."
                  disabled={ask.isPending || (seats.data?.length ?? 0) < 2 || !comments.data?.some((c) => c.authorUserId?.startsWith(SEAT_AUTHOR_PREFIX))}
                  onClick={() => ask.mutate("discuss")}
                >
                  <MessagesSquare /> Discuss
                </Button>
                {ask.isPending ? (
                  <Button type="button" variant="destructive" onClick={() => abortRef.current?.abort()}>
                    <Square /> Stop
                  </Button>
                ) : (
                  <div className="flex gap-1">
                    <select
                      className="h-9 min-w-0 flex-1 rounded-md border bg-background px-1 text-xs"
                      aria-label="Summary by"
                      value={summarySeatId}
                      onChange={(e) => setSummarySeatId(e.target.value)}
                    >
                      <option value="">Summary by…</option>
                      {(seats.data ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!comments.data?.some((c) => c.authorUserId?.startsWith(SEAT_AUTHOR_PREFIX))}
                      onClick={() => ask.mutate("summarize")}
                    >
                      Summarize
                    </Button>
                  </div>
                )}
              </div>
            </form>
            <p className="text-xs text-muted-foreground">
              Tip: type <code>@Groq</code> to ask one seat, <code>@all</code> for everyone, or click a seat name to mention it. Ctrl+Enter sends.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
