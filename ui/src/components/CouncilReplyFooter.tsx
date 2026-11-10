import { replyFooterParts, type CouncilReplyReliability } from "../pages/council-reply-labels";

export function CouncilReplyFooter({ metadata }: { metadata?: { councilReliability?: CouncilReplyReliability | null } | null }) {
  return <div className="mt-1 text-(length:--text-nano) text-muted-foreground">{replyFooterParts(metadata).map((part) => part.value).join(" · ")}</div>;
}
