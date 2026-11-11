import type { z } from "zod";
import type { memoryKindSchema, memoryOriginKindSchema, memoryStatusSchema } from "../validators/memory.js";
export interface MemoryEntry {
  id: string; companyId: string; kind: z.infer<typeof memoryKindSchema>; title: string; body: string;
  sourceUrl: string | null; sourceLabel: string | null; tags: string[]; pinned: boolean;
  status: z.infer<typeof memoryStatusSchema>; originKind: z.infer<typeof memoryOriginKindSchema>;
  originRef: string | null; createdByLabel: string; withdrawnReason: string | null;
  supersedesId: string | null; supersededById: string | null; lastUsedAt: string | null; useCount: number;
  createdAt: string; updatedAt: string; withdrawnAt: string | null;
}
