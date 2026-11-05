import type { Issue } from "@paperclipai/shared";
import { api, requestResponse } from "./client";

export interface CouncilSeatFallback {
  connectionId: string;
  grantId: string;
  model: string;
}
export type CouncilSeatRole = "none" | "researcher" | "builder" | "critic" | "synthesizer" | "moderator";

export interface CouncilSeat {
  id: string;
  issueId: string;
  name: string;
  persona: string;
  kind: "model" | "agent";
  agentId: string | null;
  adapterTypeLabel: string;
  connectionId: string | null;
  grantId: string | null;
  model: string | null;
  reasoningEffort: string | null;
  acceptsImages: boolean;
  fallbacks: CouncilSeatFallback[];
  active: boolean;
  position: number;
  role: CouncilSeatRole;
}

export type CouncilSeatInput = {
  kind?: "model";
  name: string;
  persona?: string;
  connectionId: string;
  grantId: string;
  model: string;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  acceptsImages?: boolean;
  role?: CouncilSeatRole;
  fallbacks?: CouncilSeatFallback[];
} | {
  kind: "agent";
  agentId: string;
  name?: string;
  persona?: string;
  role?: CouncilSeatRole;
};

export interface CouncilSeatResult {
  seatId: string;
  seatName: string;
  model?: string;
  failedAttempts?: Array<{ model: string; error: string }>;
  status: "ok" | "error" | "blocked" | "cancelled";
  commentId?: string;
  text?: string;
  error?: string;
  durationMs?: number;
  fallbackUsed?: boolean;
  inputTokens?: number | null;
  outputTokens?: number | null;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  latencyMs?: number;
  orchestrator?: boolean;
}

export interface CouncilRoundResult {
  roundId: string;
  userCommentId: string | null;
  /** Older turns sent to the seats as short digests to save free-tier tokens. */
  compactedTurns: number;
  results: CouncilSeatResult[];
}
export interface CouncilArtifactSummary { key: string; title: string | null; latestRevisionNumber: number; updatedAt: string; }
export interface CouncilArtifact extends CouncilArtifactSummary { body: string; revisions: Array<{ revisionNumber: number; createdAt: string }>; }
export interface CouncilArtifactReview { critiques: CouncilSeatResult[]; revision: number; revisedMarkdownPreview: string; failedCritiquePersistences: number; }
export interface CouncilReliabilitySeat { seatId: string; seatName: string; replies: number; averageLatencyMs: number | null; fallbackRate: number | null; }
export interface CouncilReliability { seats: CouncilReliabilitySeat[]; totals: Omit<CouncilReliabilitySeat, "seatId" | "seatName">; }

export const councilApi = {
  getBrief: (companyId: string, issueId: string) => api.get<{ brief: string }>(`/companies/${companyId}/council/rooms/${issueId}/brief`),
  getReliability: (companyId: string, issueId: string) => api.get<CouncilReliability>(`/companies/${companyId}/council/rooms/${issueId}/stats`),
  updateBrief: (companyId: string, issueId: string, brief: string) => api.put<{ brief: string }>(`/companies/${companyId}/council/rooms/${issueId}/brief`, { brief }),
  listArtifacts: (companyId: string, issueId: string) => api.get<CouncilArtifactSummary[]>(`/companies/${companyId}/council/rooms/${issueId}/artifacts`),
  getArtifact: (companyId: string, issueId: string, key: string, revision?: number | null) => api.get<CouncilArtifact>(`/companies/${companyId}/council/rooms/${issueId}/artifacts/${encodeURIComponent(key)}${revision ? `?revision=${revision}` : ""}`),
  saveArtifact: (companyId: string, issueId: string, input: { key: string; title: string; markdown: string }) => api.post<CouncilArtifact>(`/companies/${companyId}/council/rooms/${issueId}/artifacts`, input),
  reviewArtifact: (companyId: string, issueId: string, key: string, signal?: AbortSignal) => api.post<CouncilArtifactReview>(`/companies/${companyId}/council/rooms/${issueId}/artifacts/${encodeURIComponent(key)}/review`, {}, { signal }),
  getExportSetting: (companyId: string, issueId: string) => api.get<{ requireApproval: boolean }>(`/companies/${companyId}/council/rooms/${issueId}/export-setting`),
  updateExportSetting: (companyId: string, issueId: string, requireApproval: boolean) => api.put<{ requireApproval: boolean }>(`/companies/${companyId}/council/rooms/${issueId}/export-setting`, { requireApproval }),
  exportDocument: async (companyId: string, roomId: string, format: "docx" | "pptx", title: string, markdown: string, approved = false, consolidate = true) => {
    const response = await requestResponse(`/companies/${companyId}/council/export`, { method: "POST", body: JSON.stringify({ roomId, format, title, markdown, approved, consolidate }) });
    return { blob: await response.blob(), consolidated: response.headers.get("X-Council-Consolidated") === "true" };
  },
  listRooms: (companyId: string) => api.get<Issue[]>(`/companies/${companyId}/council/rooms`),
  listArchivedRooms: (companyId: string) => api.get<Issue[]>(`/companies/${companyId}/council/rooms?archived=1`),
  listModels: (companyId: string, connectionId: string, grantId: string) =>
    api.get<string[]>(`/companies/${companyId}/council/connections/${connectionId}/models?grantId=${grantId}`),
  createRoom: (companyId: string, title: string) => api.post<Issue>(`/companies/${companyId}/council/rooms`, { title }),
  listSeats: (companyId: string, issueId: string) =>
    api.get<CouncilSeat[]>(`/companies/${companyId}/council/rooms/${issueId}/seats`),
  addSeat: (companyId: string, issueId: string, input: CouncilSeatInput) =>
    api.post<CouncilSeat>(`/companies/${companyId}/council/rooms/${issueId}/seats`, input),
  updateSeat: (
    companyId: string,
    issueId: string,
    seatId: string,
    patch: { kind?: "model" | "agent"; agentId?: string; name?: string; persona?: string; model?: string; active?: boolean; role?: CouncilSeatRole },
  ) => api.patch<CouncilSeat>(`/companies/${companyId}/council/rooms/${issueId}/seats/${seatId}`, patch),
  removeSeat: (companyId: string, issueId: string, seatId: string) =>
    api.delete(`/companies/${companyId}/council/rooms/${issueId}/seats/${seatId}`),
  clearMessages: (companyId: string, issueId: string) =>
    api.delete(`/companies/${companyId}/council/rooms/${issueId}/messages`),
  stopRound: (companyId: string, issueId: string) =>
    api.post<{ stopped: boolean }>(`/companies/${companyId}/council/rooms/${issueId}/rounds/stop`, {}),
  // A round waits for the slowest seat, so give it far longer than the default request timeout.
  runRound: (
    companyId: string,
    issueId: string,
    input: {
      message?: string;
      mode?: "ask" | "discuss" | "summarize";
      seatId?: string;
      images?: Array<{ mediaType: string; data: string }>;
      maxOutputTokens?: number;
      clarify?: boolean;
    },
    signal?: AbortSignal,
  ) =>
    api.post<CouncilRoundResult>(
      `/companies/${companyId}/council/rooms/${issueId}/rounds`,
      {
        ...(input.message ? { message: input.message } : {}),
        mode: input.mode ?? "ask",
        ...(input.seatId ? { seatId: input.seatId } : {}),
        ...(input.images?.length ? { images: input.images } : {}),
        ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
        ...(input.clarify ? { clarify: true } : {}),
      },
      { signal },
    ),
};
