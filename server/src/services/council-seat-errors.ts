/** Turn provider errors into a short, safe message suitable for a Council seat. */
export function friendlySeatError(raw: string, ctx?: { model?: string; local?: boolean }): string {
  if (/budget limit reached/i.test(raw)) return "Budget limit reached";
  if (/agent turn failed/i.test(raw)) return "The agent could not finish its turn. Check that the agent is running (Agents page) and that its gateway is reachable.";
  if (/agent returned an empty reply/i.test(raw)) return "The agent finished without writing a reply. Try again or check its instructions.";
  if (!raw.trim() || /empty answer|no reply/i.test(raw)) return "The model returned an empty response. Thinking models can use up the answer limit; raise it in Settings or try another model.";
  if (/\b(?:401|403)\b|unauthorized|invalid api key|forbidden/i.test(raw)) return "The connection was refused (wrong or expired key). Check the connection's credentials.";
  if (/\b404\b|model not found|not found/i.test(raw)) return "That model is not available on this connection. Pick another model.";
  if (/\b429\b|rate limit|quota|too many requests/i.test(raw)) return "The provider is rate limiting this connection. Wait a minute or switch seat to another model.";
  if (/timeout|timed out|etimedout/i.test(raw)) return "The model took too long to answer. Try again or pick a faster model.";
  if (/econnrefused|enotfound|fetch failed|network/i.test(raw)) return ctx?.local
    ? "Could not reach the local model server. Is Ollama running?"
    : "Could not reach the provider. Check the connection.";
  if (/context length|too many tokens|maximum context/i.test(raw)) return "The conversation is too long for this model. Clear the chat or use a larger-context model.";
  if (/\b5\d\d\b|overloaded|bad gateway|service unavailable/i.test(raw)) return "The provider had a temporary problem. Try again.";

  const cleaned = raw
    .split(/\r?\n/)[0]!
    .replace(/https?:\/\/\S+/gi, "[address removed]")
    .replace(/\?[^\s]*\b(?:key|token|secret|api_key)=[^\s&]*/gi, "[credentials removed]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk-|AIza)[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\b(?:api[_ -]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "[credentials removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return `The model call failed: ${cleaned}. Try again.`.slice(0, 200);
}
