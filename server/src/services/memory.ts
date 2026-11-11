import { and, eq } from "drizzle-orm";
import { memoryEntries, type Db } from "@paperclipai/db";
import type { CreateMemoryInput, ListMemoryInput, UpdateMemoryInput } from "@paperclipai/shared";
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
  }).filter((item) => item.matches).sort((a, b) => Number(b.entry.pinned) - Number(a.entry.pinned) || b.score - a.score || b.entry.updatedAt.getTime() - a.entry.updatedAt.getTime()).map((item) => item.entry);
}
export function memoryContext(entries: Entry[]) {
  if (!entries.length) return "";
  return "MEMORY (reference, may be out of date):\n" + entries.map((entry) => `- [${entry.kind}] ${entry.title}: ${entry.body.slice(0, 300)} (source: ${entry.sourceLabel || entry.sourceUrl || "unknown"}; by ${entry.createdByLabel})`).join("\n");
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
