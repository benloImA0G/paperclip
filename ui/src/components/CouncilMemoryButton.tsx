import { useState } from "react";
import { memoryApi } from "../api/memory";
import { ApiError } from "../api/client";
import { useOptionalToastActions } from "../context/ToastContext";

export interface CouncilMemoryButtonProps {
  companyId: string;
  issueId: string;
  roomTitle: string;
  seatName: string;
  body: string;
  decision?: boolean;
}

export function CouncilMemoryButton({ companyId, issueId, roomTitle, seatName, body, decision }: CouncilMemoryButtonProps) {
  const toast = useOptionalToastActions();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  async function save() {
    setSaving(true);
    setNotice("");
    try {
      const title = (body.trim().match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? body.trim()).trim().slice(0, 120).trimEnd();
      await memoryApi.create(companyId, { kind: decision ? "decision" : "reference", title, body, originKind: "council", originRef: issueId, createdByLabel: seatName, sourceLabel: `Council: ${roomTitle}`, sourceUrl: null, tags: [], pinned: false } as Parameters<typeof memoryApi.create>[1] & { originKind: "council"; originRef: string; createdByLabel: string });
      const titleText = "Saved - waiting for your approval in Memory";
      if (toast) toast.pushToast({ tone: "success", title: titleText, action: { label: "Open Memory", href: "/memory" } });
      else setNotice(titleText);
    } catch (error) {
      const title = error instanceof ApiError && error.status === 409 ? "Already in Memory" : "Could not save to Memory";
      if (toast) toast.pushToast({ tone: title === "Already in Memory" ? "info" : "error", title });
      else setNotice(title);
    } finally { setSaving(false); }
  }
  return <><button type="button" className="underline hover:text-foreground" disabled={saving || !body.trim()} onClick={() => void save()}>Save to memory</button>{notice ? <span role="status"> {notice} {notice.startsWith("Saved") ? <a href="/memory" className="underline">Open Memory</a> : null}</span> : null}</>;
}
