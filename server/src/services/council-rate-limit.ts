/** Recognize provider rate-limit messages and return the bounded retry delay. */
export function isCouncilRateLimit(message: string): boolean {
  return /rate.?limit|429|too many requests|tokens per minute/i.test(message);
}

export function councilRateLimitDelayMs(message: string): number {
  const hint = /try again in\s+(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?\b/i.exec(message);
  return hint ? Math.min((Number(hint[1]) + 1) * 1_000, 20_000) : 8_000;
}
