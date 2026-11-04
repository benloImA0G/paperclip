import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Send, Users, X } from "lucide-react";
import { aiConnectionsApi } from "../api/ai-connections";
import { councilApi, type CouncilSeat, type CouncilSeatResult } from "../api/council";
import { issuesApi } from "../api/issues";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "../components/EmptyState";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";

const SEAT_AUTHOR_PREFIX = "council-seat:";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function SeatCard({ seat, result, onRemove }: { seat: CouncilSeat; result?: CouncilSeatResult; onRemove: () => void }) {
  return (
    <div className="flex min-w-[11rem] flex-col gap-1 rounded-md border bg-card px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{seat.name}</span>
        <button aria-label={`Remove ${seat.name}`} onClick={onRemove} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <span className="text-xs text-muted-foreground">{seat.model}</span>
      <span className="text-xs text-muted-foreground">
        {seat.reasoningEffort === "none" ? "thinking off" : "default thinking"}
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
  const [seatForm, setSeatForm] = useState({ name: "", grantKey: "", model: "", thinkingOff: false, fallbackKey: "", fallbackModel: "" });

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
        ...(fallback && seatForm.fallbackModel.trim()
          ? { fallbacks: [{ connectionId: fallback.id, grantId: fallback.grantId, model: seatForm.fallbackModel.trim() }] }
          : {}),
      });
    },
    onSuccess: () => {
      setAdding(false);
      setSeatForm({ name: "", grantKey: "", model: "", thinkingOff: false, fallbackKey: "", fallbackModel: "" });
      void refresh("seats");
    },
    onError: (e) => setError(errorText(e)),
  });

  const removeSeat = useMutation({
    mutationFn: (seatId: string) => councilApi.removeSeat(companyId, roomId!, seatId),
    onSuccess: () => void refresh("seats"),
    onError: (e) => setError(errorText(e)),
  });

  const ask = useMutation({
    mutationFn: () => councilApi.runRound(companyId, roomId!, message.trim()),
    onMutate: () => setError(null),
    onSuccess: (round) => {
      setMessage("");
      setLastResults(Object.fromEntries(round.results.map((r) => [r.seatId, r])));
      void refresh("comments");
    },
    onError: (e) => {
      setError(errorText(e));
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
            <button
              key={room.id}
              onClick={() => {
                setRoomId(room.id);
                setLastResults({});
              }}
              className={`rounded-md px-3 py-2 text-left text-sm ${room.id === roomId ? "bg-accent font-medium" : "hover:bg-accent/50"}`}
            >
              {room.title}
            </button>
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
                <SeatCard key={seat.id} seat={seat} result={lastResults[seat.id]} onRemove={() => removeSeat.mutate(seat.id)} />
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
                return (
                  <div key={c.id} className={seatAuthor ? "rounded-md bg-muted/50 p-3" : "rounded-md border-l-2 border-primary pl-3"}>
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">{speaker}</div>
                    <div className="whitespace-pre-wrap text-sm">{c.body}</div>
                  </div>
                );
              })}
              {comments.data && !comments.data.length ? (
                <p className="text-sm text-muted-foreground">Add seats, then ask the whole council one question.</p>
              ) : null}
              {ask.isPending ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Seats are answering…
                </p>
              ) : null}
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (message.trim() && (seats.data?.length ?? 0) > 0) ask.mutate();
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
              <Button type="submit" disabled={ask.isPending || !message.trim() || !(seats.data?.length ?? 0)}>
                <Send /> Ask all
              </Button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
