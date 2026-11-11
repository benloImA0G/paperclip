import { z } from "zod";

export const memoryKindSchema = z.enum(["fact", "decision", "preference", "reference", "lesson"]);
export const memoryOriginKindSchema = z.enum(["manual", "council", "agent"]);
export const memoryStatusSchema = z.enum(["active", "withdrawn", "pending"]);
const sourceUrl = z.string().url().refine((value) => /^https?:\/\//i.test(value), "Expected an HTTP or HTTPS URL").nullable();
const editable = {
  kind: memoryKindSchema,
  title: z.string().trim().min(1).max(160),
  body: z.string().max(8000),
  sourceUrl,
  sourceLabel: z.string().max(160).nullable(),
  tags: z.array(z.string().trim().min(1).max(32).transform((tag) => tag.toLowerCase())).max(12),
  pinned: z.boolean(),
};
export const createMemorySchema = z.object({
  ...editable,
  body: editable.body.optional(), sourceUrl: sourceUrl.optional(), sourceLabel: editable.sourceLabel.optional(),
  tags: editable.tags.optional(), pinned: editable.pinned.optional(),
  originKind: memoryOriginKindSchema.optional(), originRef: z.string().nullable().optional(),
  createdByLabel: z.string().max(160).optional(),
}).strict();
export const updateMemorySchema = z.object(editable).partial().strict();
export const withdrawMemorySchema = z.object({ reason: z.string().max(8000).optional() }).strict();
export const listMemorySchema = z.object({
  query: z.string().optional(), kind: memoryKindSchema.optional(), tag: z.string().optional(),
  status: z.enum(["active", "withdrawn", "pending", "all"]).default("active"),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
}).strict();
export const memoryContextSchema = z.object({ query: z.string().optional(), limit: z.coerce.number().int().min(1).max(20).default(8), maxChars: z.coerce.number().int().min(200).max(6000).default(1800) }).strict();
export const supersedeMemorySchema = z.object({ kind: editable.kind, title: editable.title, body: editable.body, sourceUrl: editable.sourceUrl, sourceLabel: editable.sourceLabel, tags: editable.tags }).partial().strict();
export const mergeMemorySchema = z.object({ ids: z.array(z.string().uuid()).min(2).max(10).refine((ids) => new Set(ids).size === ids.length), title: editable.title, body: editable.body, tags: editable.tags.optional() }).strict();
export const tidyMemorySchema = z.object({ staleDays: z.coerce.number().int().min(7).max(365).default(60) }).strict();
export type SupersedeMemoryInput = z.infer<typeof supersedeMemorySchema>;
export type MergeMemoryInput = z.infer<typeof mergeMemorySchema>;
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;
export type ListMemoryInput = z.infer<typeof listMemorySchema>;
