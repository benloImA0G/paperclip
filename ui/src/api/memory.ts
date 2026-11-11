import { api, requestResponse } from "./client";

export type MemoryKind = "fact" | "decision" | "preference" | "reference" | "lesson";
export interface MemoryEntry {
  id: string; companyId: string; kind: MemoryKind; title: string; body: string;
  sourceUrl: string | null; sourceLabel: string | null; tags: string[]; pinned: boolean;
  status: "active" | "withdrawn" | "pending"; originKind: "manual" | "council" | "agent";
  originRef: string | null; createdByLabel: string; withdrawnReason: string | null;
  createdAt: string; updatedAt: string; withdrawnAt: string | null;
  supersedesId: string | null; supersededById: string | null; lastUsedAt: string | null; useCount: number;
}
export type MemoryInput = Pick<MemoryEntry, "kind" | "title" | "body" | "sourceUrl" | "sourceLabel" | "tags" | "pinned">;
export const memoryApi = {
  list: (companyId: string, filters: { query?: string; kind?: MemoryKind; tag?: string; status?: "active" | "withdrawn" | "pending" | "all" } = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    return api.get<{ entries: MemoryEntry[] }>(`/companies/${companyId}/memory?${params}`);
  },
  getSettings: (companyId: string) => api.get<{ autoApprove: boolean }>(`/companies/${companyId}/memory/settings`),
  setSettings: (companyId: string, autoApprove: boolean) => api.put<{ autoApprove: boolean }>(`/companies/${companyId}/memory/settings`, { autoApprove }),
  reviewPending: (companyId: string, issueId?: string) => api.post<{ reviewed: number; approved?: number; reason?: string }>(`/companies/${companyId}/memory/review-pending`, { issueId }),
  create: (companyId: string, input: MemoryInput) => api.post<MemoryEntry>(`/companies/${companyId}/memory`, input),
  update: (companyId: string, id: string, input: Partial<MemoryInput>) => api.patch<MemoryEntry>(`/companies/${companyId}/memory/${id}`, input),
  withdraw: (companyId: string, id: string, reason?: string) => api.post<MemoryEntry>(`/companies/${companyId}/memory/${id}/withdraw`, { reason }),
  restore: (companyId: string, id: string) => api.post<MemoryEntry>(`/companies/${companyId}/memory/${id}/restore`, {}),
  approve: (companyId: string, id: string) => api.post<MemoryEntry>(`/companies/${companyId}/memory/${id}/approve`, {}),
  supersede: (companyId: string, id: string, input: Partial<Omit<MemoryInput, "pinned">>) => api.post<MemoryEntry>(`/companies/${companyId}/memory/${id}/supersede`, input),
  history: (companyId: string, id: string) => api.get<{ entries: MemoryEntry[] }>(`/companies/${companyId}/memory/${id}/history`),
  related: (companyId: string, id: string) => api.get<{ entries: MemoryEntry[] }>(`/companies/${companyId}/memory/${id}/related`),
  context: (companyId: string, query: string, maxChars = 1800) => api.get<{ text: string; entries: MemoryEntry[] }>(`/companies/${companyId}/memory/context?${new URLSearchParams({ query, maxChars: String(maxChars) })}`),
  tidy: (companyId: string) => api.get<{ duplicates: { ids: string[]; reason: string; suggestedTitle: string; suggestedBody: string }[]; stale: MemoryEntry[] }>(`/companies/${companyId}/memory/tidy?staleDays=60`),
  merge: (companyId: string, input: { ids: string[]; title: string; body: string; tags?: string[] }) => api.post<MemoryEntry>(`/companies/${companyId}/memory/merge`, input),
  extractLessons: (companyId: string, issueId: string) => api.post<{ created: MemoryEntry[]; skipped: number; autoApproved: number; reason?: string }>(`/companies/${companyId}/memory/lessons/extract`, { issueId }),
  export: async (companyId: string) => (await requestResponse(`/companies/${companyId}/memory/export`)).blob(),
};
