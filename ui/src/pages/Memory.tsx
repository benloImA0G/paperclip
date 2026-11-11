import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain } from "lucide-react";
import { memoryApi, type MemoryEntry, type MemoryInput, type MemoryKind } from "../api/memory";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { TidyPanel } from "../components/memory/TidyPanel";
import { History } from "../components/memory/History";
import { EmptyState } from "../components/EmptyState";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useOptionalToastActions } from "../context/ToastContext";

const kinds: MemoryKind[] = ["fact", "decision", "preference", "reference", "lesson", "note"];
const importFormatStorageKey = "paperclip.memory.importFormat";
function readImportFormat(): "json" | "markdown" {
  try {
    const value = localStorage.getItem(importFormatStorageKey);
    return value === "markdown" ? "markdown" : "json";
  } catch {
    return "json";
  }
}
const label = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);
const blank = (): MemoryInput => ({ kind: "reference", title: "", body: "", sourceUrl: null, sourceLabel: null, tags: [], pinned: false });

function MemoryForm({ initial, onSave, onCancel, busy, hidePinned = false }: { initial: MemoryInput; onSave: (input: MemoryInput) => void; onCancel: () => void; busy: boolean; hidePinned?: boolean }) {
  const [draft, setDraft] = useState<MemoryInput>(() => ({ kind: initial.kind, title: initial.title, body: initial.body, sourceUrl: initial.sourceUrl, sourceLabel: initial.sourceLabel, tags: initial.tags, pinned: initial.pinned }));
  const [tags, setTags] = useState(initial.tags.join(", "));
  return <form className="space-y-3 rounded-md border p-4" onSubmit={(event) => { event.preventDefault(); onSave({ ...draft, title: draft.title.trim(), sourceUrl: draft.sourceUrl?.trim() || null, sourceLabel: draft.sourceLabel?.trim() || null, tags: tags.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean) }); }}>
    <label className="block space-y-1 text-sm">Kind<select className="w-full rounded-md border bg-background px-3 py-2" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as MemoryKind })}>{kinds.map((kind) => <option key={kind} value={kind}>{label(kind)}</option>)}</select></label>
    <label className="block space-y-1 text-sm">Title<Input required maxLength={200} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
    <label className="block space-y-1 text-sm">Details<Textarea maxLength={8000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
    <label className="block space-y-1 text-sm">Source link (optional)<Input type="url" value={draft.sourceUrl ?? ""} onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })} /></label>
    <label className="block space-y-1 text-sm">Source label (optional)<Input maxLength={160} value={draft.sourceLabel ?? ""} onChange={(e) => setDraft({ ...draft, sourceLabel: e.target.value })} /></label>
    <label className="block space-y-1 text-sm">Tags (comma separated)<Input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
    {!hidePinned && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} /> Pinned</label>}
    <div className="flex justify-between"><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button><Button disabled={busy || !draft.title.trim()} type="submit">Save</Button></div>
  </form>;
}

export function Memory() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const toast = useOptionalToastActions();
  const client = useQueryClient();
  const companyId = selectedCompanyId ?? "";
  const [tidying, setTidying] = useState(false);
  const [preview, setPreview] = useState(false);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importFormat, setImportFormat] = useState<"json" | "markdown">(readImportFormat);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<MemoryKind | undefined>();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<"newest" | "recently-used" | "oldest">("newest");
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setBreadcrumbs([{ label: "Memory" }]), [setBreadcrumbs]);
  useEffect(() => { try { localStorage.setItem(importFormatStorageKey, importFormat); } catch { /* Storage can be unavailable. */ } }, [importFormat]);
  useEffect(() => { const timer = setTimeout(() => setQuery(search), 250); return () => clearTimeout(timer); }, [search]);
  const entries = useQuery({ queryKey: ["memory", companyId, query, kind, showWithdrawn], queryFn: () => memoryApi.list(companyId, { query, kind, status: showWithdrawn ? "all" : "active" }), enabled: !!companyId });
  const settings = useQuery({ queryKey: ["memory-settings", companyId], queryFn: () => memoryApi.getSettings(companyId), enabled: !!companyId });
  const settingMutation = useMutation({ mutationFn: (autoApprove: boolean) => memoryApi.setSettings(companyId, autoApprove), onSuccess: (value) => client.setQueryData(["memory-settings", companyId], value), onError: (err) => setError(err instanceof Error ? err.message : "Could not update memory settings.") });
  const pending = useQuery({ queryKey: ["memory-pending", companyId], queryFn: () => memoryApi.list(companyId, { status: "pending" }), enabled: !!companyId });
  const tagsQuery = useQuery({ queryKey: ["memory-tags", companyId], queryFn: () => memoryApi.list(companyId, { status: "active" }), enabled: !!companyId });
  const tidy = useQuery({ queryKey: ["memory-tidy", companyId], queryFn: () => memoryApi.tidy(companyId), enabled: !!companyId });
  const context = useQuery({ queryKey: ["memory-context", companyId, query], queryFn: () => memoryApi.context(companyId, query), enabled: !!companyId && preview });
  const related = useQuery({ queryKey: ["memory-related", companyId, selectedId], queryFn: () => memoryApi.related(companyId, selectedId!), enabled: !!companyId && !!selectedId });
  const mutate = useMutation({ mutationFn: (action: () => Promise<unknown>) => action(), onSuccess: () => { setError(""); void client.invalidateQueries({ queryKey: ["memory"] }); void client.invalidateQueries({ queryKey: ["memory-pending"] }); void client.invalidateQueries({ queryKey: ["memory-tags"] }); void client.invalidateQueries({ queryKey: ["memory-tidy"] }); void client.invalidateQueries({ queryKey: ["memory-context"] }); void client.invalidateQueries({ queryKey: ["memory-history"] }); void client.invalidateQueries({ queryKey: ["memory-related"] }); }, onError: (err) => setError(err instanceof ApiError && err.status === 409 ? "Already saved - open the existing one" : err instanceof Error ? err.message : "Something went wrong. Please try again.") });
  const importMutation = useMutation({ mutationFn: () => memoryApi.import(companyId, { format: importFormat, text: importText }), onSuccess: (result) => { setError(""); setImportResult(`Imported ${result.created} as pending, ${result.skippedDuplicates} duplicate skipped, ${result.skippedInvalid.length} invalid`); void client.invalidateQueries({ queryKey: ["memory"] }); void client.invalidateQueries({ queryKey: ["memory-pending"] }); }, onError: (err) => setError(err instanceof Error ? err.message : "Could not import memory.") });
  const save = (input: MemoryInput, id?: string) => mutate.mutateAsync(() => id ? memoryApi.update(companyId, id, input) : memoryApi.create(companyId, input)).then(() => { setAdding(false); setEditing(null); toast?.pushToast({ tone: "success", title: id ? "Memory updated" : "Saved to memory" }); }).catch(() => {});
  const act = (action: () => Promise<unknown>) => mutate.mutate(action);
  const download = async () => { try { const blob = await memoryApi.export(companyId); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "memory.md"; a.click(); URL.revokeObjectURL(url); } catch (err) { setError(err instanceof Error ? err.message : "Could not export memory."); } };
  if (!companyId) return <EmptyState icon={Brain} message="Select an organization to use Memory." />;
  const loaded = (entries.data?.entries ?? []).filter((entry) => entry.status !== "pending");
  const tagCounts = new Map<string, number>();
  for (const entry of loaded) for (const tag of new Set(entry.tags)) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const tags = [...tagCounts.keys()].sort((a, b) => tagCounts.get(b)! - tagCounts.get(a)! || a.localeCompare(b)).slice(0, 12);
  const visible = loaded.filter((entry) => selectedTags.every((tag) => entry.tags.includes(tag))).sort((a, b) => {
    if (sort === "recently-used") return (b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0) - (a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0);
    if (sort === "oldest") return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    return Number(b.pinned) - Number(a.pinned) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  return <div className="mx-auto max-w-4xl space-y-5 p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">Memory</h1><p className="text-sm text-muted-foreground">Notes, decisions and links your whole team and every agent can reuse. Mark one Pinned and agents see it every time.</p></div><div className="flex gap-2"><Button variant="outline" title="Find duplicate memories and merge them; review suggestions before merging." onClick={() => setTidying(!tidying)}>Find duplicates and merge{(tidy.data?.duplicates.length ?? 0) + (tidy.data?.stale.length ?? 0) > 0 && <span className="ml-1 rounded-full bg-muted px-2">{(tidy.data?.duplicates.length ?? 0) + (tidy.data?.stale.length ?? 0)}</span>}</Button><Button variant="outline" onClick={() => { setImporting(true); setImportResult(""); }}>Import</Button><Button variant="outline" onClick={() => void download()}>Export as Markdown</Button><Button onClick={() => setAdding(!adding)}>+ Add to memory</Button></div></div>
    <div className="space-y-1"><Button variant="outline" size="sm" disabled={!settings.data || settingMutation.isPending} aria-pressed={settings.data?.autoApprove ?? false} onClick={() => settingMutation.mutate(!settings.data!.autoApprove)}>Auto-approve: {settings.data?.autoApprove ? "On" : "Off"}</Button><p className="text-sm text-muted-foreground">The console approves memories it is 75%+ sure about; the rest wait for you</p>{settings.isError && <p role="alert" className="text-sm text-destructive">Could not load memory settings.</p>}</div>
    <div><Button variant="ghost" size="sm" aria-expanded={preview} onClick={() => setPreview(!preview)}>Preview what seats receive</Button><p className="text-sm text-muted-foreground">See the memory context included for agent seats, based on the current search.</p>{preview && <div className="space-y-2 rounded-md border p-3">{context.isLoading ? <p>Loading preview…</p> : context.isError ? <p role="alert">Could not load preview.</p> : <><p className="text-sm text-muted-foreground">{(context.data?.text.length ?? 0).toLocaleString()} of 1,800 characters</p><pre className="whitespace-pre-wrap text-sm">{context.data?.text}</pre></>}</div>}</div>
    <div hidden={!tidying}>{tidy.isLoading ? <p>Loading suggestions…</p> : tidy.isError ? <p role="alert">Could not load suggestions.</p> : <TidyPanel duplicates={tidy.data?.duplicates ?? []} stale={tidy.data?.stale ?? []} entries={tagsQuery.data?.entries ?? []} merge={(ids, title, body) => { void mutate.mutateAsync(() => memoryApi.merge(companyId, { ids, title, body })).then(() => toast?.pushToast({ tone: "success", title: `Merged ${ids.length} entries - the originals are kept under Show withdrawn` })).catch(() => {}); }} withdraw={(id) => act(() => memoryApi.withdraw(companyId, id))} />}</div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {pending.isError && <p role="alert" className="text-sm text-destructive">Could not load entries waiting for approval.</p>}
    {!!pending.data?.entries.length && <section className="space-y-2 rounded-md border bg-muted p-4"><h2 className="font-semibold">Waiting for approval</h2>{pending.data.entries.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2"><span>{entry.title} · {entry.createdByLabel}</span><div className="flex gap-2"><Button size="sm" disabled={mutate.isPending} onClick={() => act(() => memoryApi.approve(companyId, entry.id))}>Approve</Button><Button size="sm" variant="outline" onClick={() => { setWithdrawing(entry.id); setReason(""); }}>Withdraw</Button></div>{withdrawing === entry.id && <WithdrawForm reason={reason} setReason={setReason} cancel={() => setWithdrawing(null)} submit={() => { act(() => memoryApi.withdraw(companyId, entry.id, reason || undefined)); setWithdrawing(null); }} />}</div>)}</section>}
    {importing && <div role="dialog" aria-modal="true" aria-labelledby="import-title" className="space-y-3 rounded-md border bg-background p-4"><h2 id="import-title" className="font-semibold">Import memory</h2><label className="block space-y-1 text-sm">Format<select className="w-full rounded-md border bg-background px-3 py-2" value={importFormat} onChange={(event) => setImportFormat(event.target.value as "json" | "markdown")}><option value="json">JSON</option><option value="markdown">Markdown</option></select></label><label className="block space-y-1 text-sm">File<Input type="file" accept=".json,.md,.txt" onChange={(event) => { const file = event.target.files?.[0]; if (file) { void file.text().then(setImportText).catch(() => setError("Could not read file.")); if (file.name.endsWith(".json")) setImportFormat("json"); else if (file.name.endsWith(".md")) setImportFormat("markdown"); } }} /></label><label className="block space-y-1 text-sm">Memory text<Textarea value={importText} onChange={(event) => setImportText(event.target.value)} /></label>{importResult && <p role="status">{importResult}</p>}<div className="flex justify-between"><Button variant="ghost" onClick={() => setImporting(false)}>Close</Button><Button disabled={importMutation.isPending || !importText} onClick={() => importMutation.mutate()}>Import</Button></div></div>}
    {adding && <MemoryForm initial={blank()} busy={mutate.isPending} onSave={(input) => void save(input)} onCancel={() => setAdding(false)} />}
    <div className="space-y-3"><Input aria-label="Search memory" placeholder="Search memory" value={search} onChange={(e) => setSearch(e.target.value)} /><div className="flex flex-wrap gap-2"><Button size="sm" variant={!kind ? "secondary" : "outline"} aria-pressed={!kind} onClick={() => setKind(undefined)}>All kinds</Button>{kinds.map((item) => <Button key={item} size="sm" variant={kind === item ? "secondary" : "outline"} aria-pressed={kind === item} onClick={() => setKind(kind === item ? undefined : item)}>{label(item)}</Button>)}</div>{(tags.length > 0 || selectedTags.length > 0) && <div role="group" aria-label="Filter by tags" className="flex flex-wrap gap-2">{tags.map((item) => <Button key={item} size="sm" variant={selectedTags.includes(item) ? "secondary" : "outline"} aria-pressed={selectedTags.includes(item)} onClick={() => setSelectedTags((current) => current.includes(item) ? current.filter((tag) => tag !== item) : [...current, item])}>{item}</Button>)}{selectedTags.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelectedTags([])}>Clear</Button>}</div>}<label className="flex items-center gap-2 text-sm">Sort by<select className="rounded-md border bg-background px-3 py-2" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="newest">Pinned first, newest</option><option value="recently-used">Recently used</option><option value="oldest">Oldest</option></select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showWithdrawn} onChange={(e) => setShowWithdrawn(e.target.checked)} /> Show withdrawn</label></div>
    {entries.isLoading ? <p>Loading memory…</p> : entries.isError ? <p role="alert" className="text-destructive">Could not load memory.</p> : visible.length === 0 ? <div className="rounded-md border p-6 text-center"><p className="font-medium">Nothing in memory yet</p><p className="text-sm text-muted-foreground">Try saving an idea like:</p><p className="text-sm text-muted-foreground">Our launch checklist · Why we picked Groq as chair · Preferred answer style</p></div> : <div className="space-y-3">{visible.map((entry) => <article key={entry.id} className={`space-y-2 rounded-md border p-4 ${entry.status === "withdrawn" ? "bg-muted text-muted-foreground" : ""}`}>
      {replacing === entry.id ? <MemoryForm hidePinned initial={entry} busy={mutate.isPending} onSave={(input) => { const { pinned: _pinned, ...replacement } = input; void mutate.mutateAsync(() => memoryApi.supersede(companyId, entry.id, replacement)).then(() => setReplacing(null)).catch(() => {}); }} onCancel={() => setReplacing(null)} /> : editing === entry.id ? <MemoryForm initial={entry} busy={mutate.isPending} onSave={(input) => void save(input, entry.id)} onCancel={() => setEditing(null)} /> : <><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border px-2 py-1 text-xs">{label(entry.kind)}</span><h2 className="font-semibold"><button type="button" className="text-left hover:underline" aria-expanded={selectedId === entry.id} onClick={() => setSelectedId(selectedId === entry.id ? null : entry.id)}>{entry.title}</button></h2>{entry.status === "withdrawn" && <span className="text-xs">Withdrawn</span>}</div><p className="line-clamp-3 whitespace-pre-wrap text-sm">{entry.body}</p>{entry.sourceUrl && <a className="text-sm text-primary underline" href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">{entry.sourceLabel || entry.sourceUrl}</a>}<div className="flex flex-wrap gap-2">{entry.tags.map((item) => <span key={item} className="rounded-full bg-muted px-2 py-1 text-xs">{item}</span>)}</div><p className="text-xs text-muted-foreground">{entry.createdByLabel} · {new Date(entry.createdAt).toLocaleDateString()}</p><p className="text-xs text-muted-foreground">{entry.useCount ? `Used ${entry.useCount} times - last used ${entry.lastUsedAt ? new Date(entry.lastUsedAt).toLocaleDateString() : "unknown"}` : "Not used yet"}</p>{entry.withdrawnReason && <p className="text-sm">Reason: {entry.withdrawnReason}</p>}<div className="flex flex-wrap gap-2">{entry.status === "active" ? <><Button size="sm" variant="outline" aria-pressed={entry.pinned} disabled={mutate.isPending} onClick={() => act(() => memoryApi.update(companyId, entry.id, { pinned: !entry.pinned }))}>{entry.pinned ? "Unpin" : "Pin"}</Button><Button size="sm" variant="outline" onClick={() => setEditing(entry.id)}>Edit</Button><Button size="sm" variant="outline" onClick={() => setReplacing(entry.id)}>Replace with new version</Button><Button size="sm" variant="outline" onClick={() => { setWithdrawing(entry.id); setReason(""); }}>Withdraw</Button></> : <Button size="sm" variant="outline" disabled={mutate.isPending} onClick={() => act(() => memoryApi.restore(companyId, entry.id))}>Restore</Button>}<Button size="sm" variant="outline" aria-expanded={historyId === entry.id} onClick={() => setHistoryId(historyId === entry.id ? null : entry.id)}>History</Button></div>{selectedId === entry.id && related.isLoading && <p aria-live="polite" className="text-sm text-muted-foreground">Loading related…</p>}{selectedId === entry.id && related.isSuccess && related.data.entries.length === 0 && <p className="text-sm text-muted-foreground">No related entries</p>}{selectedId === entry.id && related.isError && <p role="alert" className="text-sm text-destructive">Could not load related memory.</p>}{selectedId === entry.id && !!related.data?.entries.length && <div className="space-y-1 text-sm"><h3 className="font-semibold">Related</h3><ul>{related.data.entries.map((item) => <li key={item.id}><button type="button" className="text-primary underline" onClick={() => { setSearch(""); setQuery(""); setKind(undefined); setSelectedTags([]); setSelectedId(item.id); }}>{item.title}</button></li>)}</ul></div>}{historyId === entry.id && <History companyId={companyId} id={entry.id} />}{withdrawing === entry.id && <WithdrawForm reason={reason} setReason={setReason} cancel={() => setWithdrawing(null)} submit={() => { act(() => memoryApi.withdraw(companyId, entry.id, reason || undefined)); setWithdrawing(null); }} />}</>}
    </article>)}</div>}
  </div>;
}
function WithdrawForm({ reason, setReason, submit, cancel }: { reason: string; setReason: (reason: string) => void; submit: () => void; cancel: () => void }) {
  return <div className="w-full space-y-2"><label className="block text-sm">Reason (optional)<Input value={reason} onChange={(e) => setReason(e.target.value)} /></label><div className="flex gap-2"><Button size="sm" variant="outline" onClick={cancel}>Cancel</Button><Button size="sm" onClick={submit}>Confirm withdrawal</Button></div></div>;
}
