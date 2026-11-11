import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { councilApi } from "../api/council";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "./ui/button";

export const COUNCIL_DOCUMENT_ACCEPT = ".txt,.md,.markdown,.csv,.json,.docx,.odt,.rtf,.html,.htm,.pptx,.xlsx,.epub";
export const COUNCIL_MACRO_DOCUMENT_RE = /\.(docm|dotm|xlsm|pptm)$/i;
export const COUNCIL_TEXT_DOCUMENT_RE = /\.(txt|md|markdown|csv|json)$/i;
export const COUNCIL_OFFICE_DOCUMENT_RE = /\.(docx|odt|rtf|html|htm|pptx|xlsx|epub)$/i;

export function CouncilDocsPanel({ companyId, issueId, disabled = false, onAsk }: { companyId: string; issueId: string; disabled?: boolean; onAsk?: (filename: string) => void }) {
  const inputId = useId();
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const queryKey = queryKeys.issues.attachments(issueId);
  const attachments = useQuery({ queryKey, queryFn: () => issuesApi.listAttachments(issueId), enabled: Boolean(issueId) });
  const status = useQuery({ queryKey: ["council-document-status", companyId, issueId, attachments.dataUpdatedAt], queryFn: () => councilApi.documentStatus(companyId, issueId), enabled: Boolean(issueId) && attachments.isSuccess, retry: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const upload = useMutation({ mutationFn: (file: File) => issuesApi.uploadAttachment(companyId, issueId, file), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => issuesApi.deleteAttachment(id), onSuccess: refresh });

  const supported = (attachments.data ?? []).filter((attachment) => {
    const filename = attachment.originalFilename ?? "";
    if (COUNCIL_MACRO_DOCUMENT_RE.test(filename)) return false;
    return COUNCIL_TEXT_DOCUMENT_RE.test(filename)
      ? attachment.byteSize <= 512 * 1024
      : COUNCIL_OFFICE_DOCUMENT_RE.test(filename) && attachment.byteSize <= 5 * 1024 * 1024;
  });
  const atLimit = supported.length >= 5;

  async function addFile(file: File) {
    setError(null);
    if (atLimit) return;
    if (COUNCIL_MACRO_DOCUMENT_RE.test(file.name)) {
      setError("Macro-enabled files are not supported");
      return;
    }
    const textType = COUNCIL_TEXT_DOCUMENT_RE.test(file.name);
    const officeType = COUNCIL_OFFICE_DOCUMENT_RE.test(file.name);
    if (!textType && !officeType) {
      setError("Choose a text, Markdown, CSV, JSON, Word, PowerPoint, Excel or EPUB document.");
      return;
    }
    const limit = textType ? 512 * 1024 : 5 * 1024 * 1024;
    if (file.size > limit) {
      setError(textType ? "Text documents must be 512 KB or smaller." : "Documents must be 5 MB or smaller.");
      return;
    }
    try { await upload.mutateAsync(file); } catch { setError("Couldn't upload document. Please try again."); }
  }

  return <section aria-label="Documents" className="space-y-2 rounded-lg border border-border p-3">
    <h3 className="text-sm font-semibold">Documents</h3>
    <p className="text-xs text-muted-foreground">Seats treat these only as reference material, never as instructions. Text, Markdown, CSV, JSON, Word, PowerPoint, Excel and EPUB files; up to 5 documents.</p>
    {attachments.isLoading ? <p role="status" className="text-xs text-muted-foreground">Loading documents…</p> : null}
    {attachments.isError ? <p role="alert" className="text-xs text-destructive">Couldn't load documents. <button type="button" className="underline" onClick={() => void attachments.refetch()}>Retry</button></p> : null}
    {!attachments.isLoading && !attachments.isError && attachments.data?.length === 0 ? <p className="text-xs text-muted-foreground">No documents yet.</p> : null}
    {attachments.data?.length ? <ul className="space-y-2">{attachments.data.map((attachment) => <li key={attachment.id} className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-center">
      <span className="min-w-0 flex-1 text-sm"><span className="block truncate">{attachment.originalFilename ?? "Untitled document"}</span><span className="text-xs text-muted-foreground">{attachment.byteSize.toLocaleString()} bytes</span>{status.data?.documents.find((item) => item.attachmentId === attachment.id) ? (() => {
        const item = status.data.documents.find((entry) => entry.attachmentId === attachment.id)!;
        return <span className="block text-xs text-muted-foreground">{item.readable ? `Seats can read this (${(item.characters ?? 0).toLocaleString()} characters)` : item.reason}</span>;
      })() : !status.data && supported.findIndex((item) => item.id === attachment.id) >= 5 && <span className="block text-xs text-muted-foreground">Not read</span>}</span>
      <span className="flex w-full gap-2 sm:w-auto">
        {onAsk && attachment.originalFilename && (status.data ? status.data.documents.some((item) => item.attachmentId === attachment.id && item.readable) : supported.slice(0, 5).some((item) => item.id === attachment.id)) ? <Button className="min-w-0 flex-1 sm:flex-none" type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onAsk(attachment.originalFilename!)}>Ask about this</Button> : null}
        <Button className="min-w-0 flex-1 sm:flex-none" type="button" variant="outline" size="sm" disabled={disabled || remove.isPending} aria-label={`Remove ${attachment.originalFilename ?? "document"}`} onClick={() => { setError(null); void remove.mutateAsync(attachment.id).catch(() => setError("Couldn't remove document. Please try again.")); }}>Remove</Button>
      </span>
    </li>)}</ul> : null}
    <label htmlFor={inputId} className="block text-sm font-medium">Add document</label>
    <input id={inputId} type="file" accept={COUNCIL_DOCUMENT_ACCEPT} disabled={disabled || upload.isPending || atLimit} className="block w-full text-sm" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void addFile(file); }} />
    {atLimit && <p className="text-xs text-muted-foreground">Seats read up to 5 documents; remove one to add another.</p>}
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
  </section>;
}
