/** Recognize provider rate-limit messages and return the bounded retry delay. */
export function isCouncilRateLimit(message: string): boolean {
  return /rate.?limit|429|too many requests|tokens per minute/i.test(message);
}

export function councilRateLimitDelayMs(message: string): number {
  const hint = /try again in\s+(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?\b/i.exec(message);
  return hint ? Math.min((Number(hint[1]) + 1) * 1_000, 20_000) : 8_000;
}

type Waiter = { grant: () => void; abort: () => void };
type ConnectionQueue = { active: number; waiting: Waiter[] };
const connectionQueues = new Map<string, ConnectionQueue>();

/** Limit active model calls per connection, with abortable FIFO admission. */
export async function withCouncilConnectionLimit<T>(
  connectionId: string,
  signal: AbortSignal,
  call: () => Promise<T>,
  onWait?: (milliseconds: number) => void,
): Promise<T> {
  const raw = Number(process.env.COUNCIL_MAX_CONCURRENT_PER_CONNECTION);
  const limit = process.env.COUNCIL_MAX_CONCURRENT_PER_CONNECTION !== undefined && Number.isFinite(raw) ? Math.max(1, Math.min(8, Math.floor(raw))) : 2;
  const started = Date.now();
  const abortError = () => new DOMException("Council round stopped", "AbortError");
  if (signal.aborted) throw abortError();
  const queue = connectionQueues.get(connectionId) ?? { active: 0, waiting: [] };
  connectionQueues.set(connectionId, queue);
  const drain = () => {
    while (queue.waiting.length && queue.active < limit) queue.waiting.shift()!.grant();
    if (!queue.active && !queue.waiting.length) connectionQueues.delete(connectionId);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => { signal.removeEventListener("abort", waiter.abort); queue.active++; resolve(); },
        abort: () => {
          const index = queue.waiting.indexOf(waiter);
          if (index !== -1) queue.waiting.splice(index, 1);
          signal.removeEventListener("abort", waiter.abort);
          drain();
          reject(abortError());
        },
      };
      queue.waiting.push(waiter);
      signal.addEventListener("abort", waiter.abort, { once: true });
      if (signal.aborted) waiter.abort();
      else drain();
    });
  } finally {
    onWait?.(Date.now() - started);
  }
  try {
    if (signal.aborted) throw abortError();
    return await call();
  } finally {
    queue.active--;
    drain();
  }
}
