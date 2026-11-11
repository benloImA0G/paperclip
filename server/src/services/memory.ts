import { and, eq, inArray, sql } from "drizzle-orm";
import { memoryEntries, memorySettings, type Db } from "@paperclipai/db";
import type { CreateMemoryInput, ListMemoryInput, UpdateMemoryInput, SupersedeMemoryInput, MergeMemoryInput } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";

type Entry = typeof memoryEntries.$inferSelect;
export class MemoryDuplicateError extends Error {
  constructor(public existingId: string) { super("An active memory with this kind and title already exists"); }
}
export function rankMemory(entries: Entry[], query?: string) {
  const words = (query ?? "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.map((entry) => {
    const title = entry.title.toLowerCase();
    const haystack = [title, entry.body, ...entry.tags, entry.sourceLabel ?? ""].join(" ").toLowerCase();
    return { entry, matches: words.every((word) => haystack.includes(word)), score: words.filter((word) => title.includes(word)).length };
  }).filter((item) => item.matches).sort((a, b) => Number(b.entry.pinned) - Number(a.entry.pinned) || b.score - a.score || b.entry.updatedAt.getTime() - a.entry.updatedAt.getTime() || a.entry.id.localeCompare(b.entry.id)).map((item) => item.entry);
}
const stopWords = new Set("a an and are as at be by for from in is it of on or that the this to was were with".split(" "));
function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => !stopWords.has(word)));
}
export function lessonSimilarity(a: { title: string; body: string }, b: { title: string; body: string }): number {
  const x = words(`${a.title} ${a.body}`), y = words(`${b.title} ${b.body}`);
  const union = new Set([...x, ...y]);
  return union.size ? overlap(x, y) / union.size : 0;
}
export function findSimilarGroups<T extends { title: string; body: string; kind: string; status: string }>(entries: T[], threshold = 0.6): T[][] {
  const eligible = entries.filter((entry) => entry.status === "active" || entry.status === "pending");
  const parent = eligible.map((_, i) => i);
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]!));
  for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
    const a = eligible[i]!, b = eligible[j]!;
    if (a.kind === b.kind && lessonSimilarity(a, b) >= threshold) parent[root(j)] = root(i);
  }
  const groups = new Map<number, T[]>();
  eligible.forEach((entry, i) => { const key = root(i); groups.set(key, [...(groups.get(key) ?? []), entry]); });
  return [...groups.values()].filter((group) => group.length > 1);
}
function overlap(a: Set<string>, b: Set<string>): number {
  return [...a].filter((word) => b.has(word)).length;
}
export function relatedEntries(entries: Entry[], entry: Entry, limit = 3): Entry[] {
  const title = words(entry.title);
  const tags = new Set(entry.tags.map((tag) => tag.toLowerCase()));
  return entries.filter((candidate) => candidate.id !== entry.id).map((candidate) => ({
    entry: candidate,
    score: overlap(title, words(candidate.title)) + overlap(tags, new Set(candidate.tags.map((tag) => tag.toLowerCase()))),
  })).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.updatedAt.getTime() - a.entry.updatedAt.getTime() || a.entry.id.localeCompare(b.entry.id))
    .slice(0, Math.max(0, limit)).map((item) => item.entry);
}
const contextHeader = "MEMORY (reference, may be out of date):\n";
export function selectMemoryContext(entries: Entry[], { maxChars = 1800, query }: { maxChars?: number; query?: string } = {}) {
  const queryWords = words(query ?? "");
  const score = (entry: Entry) => overlap(queryWords, words(entry.title)) * 3
    + overlap(queryWords, words(entry.tags.join(" "))) * 2 + overlap(queryWords, words(entry.body));
  const scores = new Map(queryWords.size ? entries.map((entry) => [entry, score(entry)] as const) : []);
  const ordered = [...entries].sort((a, b) => Number(b.pinned) - Number(a.pinned)
    || (queryWords.size && !a.pinned ? (scores.get(b)! - scores.get(a)! || b.updatedAt.getTime() - a.updatedAt.getTime()) : 0) || a.id.localeCompare(b.id));
  const included: Entry[] = [];
  const lines: string[] = [];
  for (const entry of ordered) {
    const line = `- [${entry.kind}] ${entry.title}: ${entry.body.slice(0, 300)} (source: ${entry.sourceLabel || entry.sourceUrl || "unknown"}; by ${entry.createdByLabel})`;
    if (included.length && contextHeader.length + lines.join("\n").length + 1 + line.length > maxChars) break;
    included.push(entry); lines.push(line);
  }
  return { text: lines.length ? contextHeader + lines.join("\n") : "", entries: included };
}
export function memoryContext(entries: Entry[], options?: { maxChars?: number; query?: string }) {
  return selectMemoryContext(entries, options).text;
}
export function memoryService(db: Db) {
  async function get(companyId: string, id: string) {
    const row = await db.select().from(memoryEntries).where(and(eq(memoryEntries.companyId, companyId), eq(memoryEntries.id, id))).then((rows) => rows[0]);
    if (!row) throw notFound("Memory entry not found");
    return row;
  }
  async function duplicate(companyId: string, kind: string, title: string, exceptId?: string) {
    const rows = await db.select().from(memoryEntries).where(and(eq(memoryEntries.companyId, companyId), eq(memoryEntries.status, "active"), eq(memoryEntries.kind, kind), eq(memoryEntries.title, title)));
    const existing = rows.find((row) => row.id !== exceptId);
    if (existing) throw new MemoryDuplicateError(existing.id);
  }
  async function withDuplicateCheck<T>(companyId: string, kind: string, title: string, operation: () => Promise<T>, exceptId?: string): Promise<T> {
    try { return await operation(); } catch (error) {
      const cause = error as { code?: string; cause?: { code?: string } };
      if (cause.code === "23505" || cause.cause?.code === "23505") await duplicate(companyId, kind, title, exceptId);
      throw error;
    }
  }
  async function update(companyId: string, id: string, values: Partial<typeof memoryEntries.$inferInsert>) {
    const current = await get(companyId, id);
    if ((values.status ?? current.status) === "active") await duplicate(companyId, values.kind ?? current.kind, values.title ?? current.title, id);
    const [row] = await withDuplicateCheck(companyId, values.kind ?? current.kind, values.title ?? current.title, () => db.update(memoryEntries).set({ ...values, updatedAt: new Date() }).where(and(eq(memoryEntries.companyId, companyId), eq(memoryEntries.id, id))).returning(), id);
    if (!row) throw notFound("Memory entry not found");
    return row;
  }
  return {
    get,
    async getSettings(companyId: string) {
      const [row] = await db.select().from(memorySettings).where(eq(memorySettings.companyId, companyId));
      return { autoApprove: row?.autoApprove ?? true };
    },
    async setSettings(companyId: string, autoApprove: boolean) {
      const [row] = await db.insert(memorySettings).values({ companyId, autoApprove }).onConflictDoUpdate({ target: memorySettings.companyId, set: { autoApprove, updatedAt: new Date() } }).returning();
      return { autoApprove: row!.autoApprove };
    },
    async list(companyId: string, filters: ListMemoryInput) {
      const conditions = [eq(memoryEntries.companyId, companyId)];
      if (filters.status !== "all") conditions.push(eq(memoryEntries.status, filters.status));
      if (filters.kind) conditions.push(eq(memoryEntries.kind, filters.kind));
      const rows = await db.select().from(memoryEntries).where(and(...conditions));
      const tagged = filters.tag ? rows.filter((row) => row.tags.includes(filters.tag!.toLowerCase())) : rows;
      const ranked = rankMemory(tagged, filters.query);
      return filters.limit ? ranked.slice(0, filters.limit) : ranked;
    },
    async create(companyId: string, input: CreateMemoryInput) {
      const status = !input.originKind || input.originKind === "manual" ? "active" : "pending";
      if (status === "active") await duplicate(companyId, input.kind, input.title);
      const [row] = await withDuplicateCheck(companyId, input.kind, input.title, () => db.insert(memoryEntries).values({ ...input, companyId, status, createdByLabel: input.createdByLabel || "Board" }).returning());
      return row!;
    },
    async context(companyId: string, entries: Entry[], options?: { maxChars?: number; query?: string }) {
      const selected = selectMemoryContext(entries, options);
      if (selected.entries.length) {
        try {
          await db.update(memoryEntries).set({ lastUsedAt: new Date(), useCount: sql`${memoryEntries.useCount} + 1` })
            .where(and(eq(memoryEntries.companyId, companyId), inArray(memoryEntries.id, selected.entries.map((entry) => entry.id))));
        } catch { /* Context remains available when usage accounting fails. */ }
      }
      return selected;
    },
    async history(companyId: string, id: string) {
      const entries: Entry[] = []; const seen = new Set<string>();
      let next: string | null = id;
      while (next && !seen.has(next)) { seen.add(next); const entry = await get(companyId, next); entries.push(entry); next = entry.supersedesId; }
      return entries;
    },
    async supersede(companyId: string, id: string, input: SupersedeMemoryInput) {
      return db.transaction(async (tx) => {
        const [old] = await tx.select().from(memoryEntries).where(and(eq(memoryEntries.companyId, companyId), eq(memoryEntries.id, id))).for("update");
        if (!old) throw notFound("Memory entry not found");
        if (old.status !== "active") throw conflict("Only active memories can be superseded");
        const now = new Date();
        await tx.update(memoryEntries).set({ status: "withdrawn", withdrawnReason: "superseded", withdrawnAt: now, updatedAt: now }).where(eq(memoryEntries.id, id));
        const [entry] = await tx.insert(memoryEntries).values({ companyId, kind: input.kind ?? old.kind, title: input.title ?? old.title, body: input.body ?? old.body, sourceUrl: input.sourceUrl === undefined ? old.sourceUrl : input.sourceUrl, sourceLabel: input.sourceLabel === undefined ? old.sourceLabel : input.sourceLabel, tags: input.tags ?? old.tags, pinned: old.pinned, originKind: old.originKind, originRef: old.originRef, createdByLabel: old.createdByLabel, supersedesId: old.id }).returning();
        await tx.update(memoryEntries).set({ supersededById: entry!.id }).where(eq(memoryEntries.id, id));
        return entry!;
      });
    },
    async merge(companyId: string, input: MergeMemoryInput) {
      return db.transaction(async (tx) => {
        const rows = await tx.select().from(memoryEntries).where(and(eq(memoryEntries.companyId, companyId), inArray(memoryEntries.id, input.ids))).orderBy(memoryEntries.id).for("update");
        if (rows.length !== input.ids.length) throw notFound("Memory entry not found");
        const ordered = input.ids.map((id) => rows.find((row) => row.id === id)!);
        if (ordered.some((row) => (row.status !== "active" && row.status !== "pending") || row.kind !== ordered[0]!.kind)) throw conflict("Memories must be active or pending and of the same kind");
        const now = new Date();
        await tx.update(memoryEntries).set({ status: "withdrawn", withdrawnReason: "merged", withdrawnAt: now, updatedAt: now }).where(and(eq(memoryEntries.companyId, companyId), inArray(memoryEntries.id, input.ids)));
        const first = ordered[0]!;
        const [entry] = await tx.insert(memoryEntries).values({ companyId, kind: first.kind, title: input.title, body: input.body, tags: [...new Set([...ordered.flatMap((row) => row.tags), ...(input.tags ?? [])])], pinned: ordered.some((row) => row.pinned), originKind: first.originKind, originRef: first.originRef, createdByLabel: first.createdByLabel, supersedesId: first.id }).returning();
        await tx.update(memoryEntries).set({ supersededById: entry!.id }).where(and(eq(memoryEntries.companyId, companyId), inArray(memoryEntries.id, input.ids)));
        return entry!;
      });
    },
    async tidy(companyId: string, staleDays: number) {
      const rows = await db.select().from(memoryEntries).where(and(eq(memoryEntries.companyId, companyId), inArray(memoryEntries.status, ["active", "pending"])));
      const duplicates = findSimilarGroups(rows).map((group) => ({ ids: group.map((row) => row.id), reason: "Similar memories", suggestedTitle: group.reduce((a, b) => a.title.length <= b.title.length ? a : b).title, suggestedBody: [...new Set(group.flatMap((row) => row.body.split("\n")).map((line) => line.trim()).filter(Boolean))].join("\n\n").slice(0, 2000) }));
      const cutoff = Date.now() - staleDays * 86400000;
      return { duplicates, stale: rows.filter((row) => row.status === "active" && !row.pinned && (row.lastUsedAt ?? row.createdAt).getTime() < cutoff) };
    },
    patch: (companyId: string, id: string, input: UpdateMemoryInput) => update(companyId, id, input),
    async withdraw(companyId: string, id: string, reason?: string) {
      const entry = await get(companyId, id);
      if (entry.status === "withdrawn") throw conflict("This memory is already withdrawn");
      return update(companyId, id, { status: "withdrawn", withdrawnAt: new Date(), withdrawnReason: reason ?? null });
    },
    async restore(companyId: string, id: string) {
      const entry = await get(companyId, id);
      if (entry.status !== "withdrawn") throw conflict("Only withdrawn memories can be restored");
      return update(companyId, id, { status: "active", withdrawnAt: null, withdrawnReason: null });
    },
    async approve(companyId: string, id: string) {
      const entry = await get(companyId, id);
      if (entry.status !== "pending") throw conflict("Only pending memories can be approved");
      return update(companyId, id, { status: "active", withdrawnAt: null, withdrawnReason: null });
    },
  };
}
