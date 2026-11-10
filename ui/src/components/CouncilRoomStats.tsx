import type { CouncilReplyReliability } from "../pages/council-reply-labels";

type Reply = { metadata?: { councilReliability?: CouncilReplyReliability | null } | null };

export function sumCouncilReplies(replies: Reply[]) {
  let tokens = 0;
  let hasTokens = false;
  let allHaveTokens = true;
  let costCents = 0;
  let allPriced = true;
  let allLocal = replies.length > 0;
  for (const reply of replies) {
    const r = reply.metadata?.councilReliability;
    const usage = [r?.usage?.inputTokens, r?.usage?.outputTokens];
    if (!usage.some((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) allHaveTokens = false;
    for (const value of usage) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) { tokens += value; hasTokens = true; }
    }
    if (r?.local !== true) allLocal = false;
    const raw = r?.costCents;
    const price = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isFinite(price) || price < 0 || /unknown|estimated[-_ ]missing/i.test(r?.costStatus ?? "")) allPriced = false;
    else costCents += price;
  }
  return { replies: replies.length, tokens: hasTokens ? tokens : null, allHaveTokens, cost: allLocal ? "FREE (Local)" : allPriced && replies.length ? `$${(costCents / 100).toFixed(6).replace(/0+$/, "").replace(/\.$/, ".00").replace(/(\.\d)$/, "$10")}` : "cost unavailable" };
}

export function CouncilRoomStats({ replies }: { replies: Reply[] }) {
  if (!replies.length) return null;
  const total = sumCouncilReplies(replies);
  return <p className="text-xs text-muted-foreground">{total.replies} {total.replies === 1 ? "reply" : "replies"} · {total.tokens === null ? "tokens unavailable" : `${total.allHaveTokens ? "" : "at least "}${total.tokens.toLocaleString()} tokens`} · {total.cost}</p>;
}

export function formatCouncilMarkdown(messages: Array<{ name: string; body: string }>) {
  return messages.map(({ name, body }) => `**${name}:** ${body}`).join("\n\n");
}
