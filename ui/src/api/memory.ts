import { api, requestResponse } from "./client";

export type MemoryKind = "fact" | "decision" | "preference" | "reference" | "lesson";
export interface MemoryEntry {
  id: string; companyId: string; kind: MemoryKind; title: string; body: string;
  sourceUrl: string | null; sourceLabel: string | null; tags: string[]; pinned: boolean;
  status: "active" | "withdrawn" | "pending"; originKind: "manual" | "council" | "agent";
  originRef: string | null; createdByLabel: string; withdrawnReason: string | null;
  createdAt: string; updatedAt: string; withdrawnAt: string | null;
}
export type MemoryInput = Pick<MemoryEntry, "kind" | "title" | "body" | "sourceUrl" | "sourceLabel" | "tags" | "pinned">;
export const memoryApi = {
  list: (companyId: string, filters: { query?: string; kind?: MemoryKind; tag?: string; status?: "active" | "withdrawn" | "pending" | "all" } = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    return api.get<{ entries: MemoryEntry[] }>(`/companies/${companyId}/memory?${params}`);
  },
  create: (companyId: string, input: MemoryInput) => api.post<MemoryEntry>(`/companies/${companyId}/memory`, input),
  update: (companyId: string, id: string, input: Partial<MemoryInput>) => api.patch<MemoryEntry>(`/companies/${companyId}/memory/${id}`, input),
  withdraw: (companyId: string, id: string, reason?: string) => api.post<MemoryEntry>(`/companies/${companyId}/memory/${id}/withdraw`, { reason }),
  restore: (companyId: string, id: string) => api.post<MemoryEntry>(`/companies/${companyId}/memory/${id}/restore`, {}),
  approve: (companyId: string, id: string) => api.post<MemoryEntry>(`/companies/${companyId}/memory/${id}/approve`, {}),
  export: async (companyId: string) => (await requestResponse(`/companies/${companyId}/memory/export`)).blob(),
};
