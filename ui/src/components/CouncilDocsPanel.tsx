import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "./ui/button";

export function CouncilDocsPanel({ companyId, issueId, disabled = false }: { companyId: string; issueId: string; disabled?: boolean }) {
  const inputId = useId();
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const queryKey = queryKeys.issues.attachments(issueId);
  const attachments = useQuery({ queryKey, queryFn: () => issuesApi.listAttachments(issueId), enabled: Boolean(issueId) });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const upload = useMutation({ mutationFn: (file: File) => issuesApi.uploadAttachment(companyId, issueId, file), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => issuesApi.deleteAttachment(id), onSuccess: refresh });

  async function addFile(file: File) {
    setError(null);
    if (!/\.(txt|md|markdown|csv|json)$/i.test(file.name)) {
      setError("Choose a text, Markdown, CSV or JSON file.");
      return;
    }
    if (file.size > 512 * 1024) {
      setError("Documents must be 512 KB or smaller.");
      return;
    }
    try { await upload.mutateAsync(file); } catch { setError("Couldn't upload document. Please try again."); }
  }

  return <section aria-label="Documents" className="space-y-2 rounded-lg border border-border p-3">
    <h3 className="text-sm font-semibold">Documents</h3>
    <p className="text-xs text-muted-foreground">Seats read these as untrusted reference text. Text, Markdown, CSV and JSON only for now.</p>
    {attachments.isLoading ? <p role="status" className="text-xs text-muted-foreground">Loading documents…</p> : null}
    {attachments.isError ? <p role="alert" className="text-xs text-destructive">Couldn't load documents. <button type="button" className="underline" onClick={() => void attachments.refetch()}>Retry</button></p> : null}
    {!attachments.isLoading && !attachments.isError && attachments.data?.length === 0 ? <p className="text-xs text-muted-foreground">No documents yet.</p> : null}
    {attachments.data?.length ? <ul className="space-y-2">{attachments.data.map((attachment) => <li key={attachment.id} className="flex min-w-0 items-center gap-2 rounded-md border border-border p-2">
      <span className="min-w-0 flex-1 text-sm"><span className="block truncate">{attachment.originalFilename ?? "Untitled document"}</span><span className="text-xs text-muted-foreground">{attachment.byteSize.toLocaleString()} bytes</span></span>
      <Button type="button" variant="outline" size="sm" disabled={disabled || remove.isPending} aria-label={`Remove ${attachment.originalFilename ?? "document"}`} onClick={() => { setError(null); void remove.mutateAsync(attachment.id).catch(() => setError("Couldn't remove document. Please try again.")); }}>Remove</Button>
    </li>)}</ul> : null}
    <label htmlFor={inputId} className="block text-sm font-medium">Add document</label>
    <input id={inputId} type="file" accept=".txt,.md,.markdown,.csv,.json" disabled={disabled || upload.isPending} className="block w-full text-sm" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void addFile(file); }} />
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
  </section>;
}
