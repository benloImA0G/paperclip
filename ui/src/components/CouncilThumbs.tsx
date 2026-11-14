import { useState } from "react";

export type CouncilVote = "up" | "down";

export function CouncilThumbs({
  messageId,
  initialVote = null,
  onVote,
}: {
  messageId: string;
  initialVote?: CouncilVote | null;
  onVote: (vote: CouncilVote | null) => Promise<void>;
}) {
  const [vote, setVote] = useState<CouncilVote | null>(initialVote);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function choose(next: CouncilVote) {
    if (saving) return;
    const previous = vote;
    const target = previous === next ? null : next;
    setVote(target);
    setFailed(false);
    setSaving(true);
    try {
      await onVote(target);
    } catch {
      setVote(previous);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const buttonClass = (active: boolean) =>
    `rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50 ${active ? "bg-muted font-medium" : ""}`;

  return (
    <div data-message-id={messageId} className="flex min-w-0 flex-wrap items-center gap-2">
      <button
        type="button"
        aria-label="This answer helped"
        aria-pressed={vote === "up"}
        disabled={saving}
        className={buttonClass(vote === "up")}
        onClick={() => void choose("up")}
      >
        {"\u{1F44D}"}
      </button>
      <button
        type="button"
        aria-label="This answer did not help"
        aria-pressed={vote === "down"}
        disabled={saving}
        className={buttonClass(vote === "down")}
        onClick={() => void choose("down")}
      >
        {"\u{1F44E}"}
      </button>
      {failed ? <span role="alert" className="text-xs text-destructive">Could not save</span> : null}
    </div>
  );
}
