import type { CouncilRoundOrder, CouncilRoundStyle, Issue } from "@paperclipai/shared";
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
  /** Present on a discussion round run with `stance`. */
  agreement?: CouncilAgreement;
  jury?: { answerSeat: string; verdict: "pass" | "fail" | "revise"; counts: Record<"pass" | "fail" | "revise", number>; unanimous: boolean; judges: number };
  ranking?: { order: Array<{ seatName: string; points: number; firstPlace: number }>; judges: number };
  dissent?: { strength: "strong" | "weak" | "none"; argument: string };
}

export interface CouncilAgreement {
  percent: number;
  label: "Strong agreement" | "Agreement with concessions" | "Split" | "No agreement" | "Not enough input";
  plain: string;
  reached: boolean;
  counts: { agree: number; conditions: number; disagree: number; abstain: number };
  concessions: Array<{ seat: string; text: string }>;
  objections: Array<{ seat: string; text: string }>;
}
export interface CouncilArtifactSummary { key: string; title: string | null; latestRevisionNumber: number; updatedAt: string; }
export interface CouncilArtifact extends CouncilArtifactSummary { body: string; revisions: Array<{ revisionNumber: number; createdAt: string }>; }
export interface CouncilArtifactReview { critiques: CouncilSeatResult[]; revision: number; revisedMarkdownPreview: string; failedCritiquePersistences: number; }
export interface CouncilReliabilitySeat { seatId: string; seatName: string; replies: number; averageLatencyMs: number | null; fallbackRate: number | null; }
export interface CouncilReliability { seats: CouncilReliabilitySeat[]; totals: Omit<CouncilReliabilitySeat, "seatId" | "seatName">; }
export type CouncilEstimateMode = "ask" | "discuss" | "summarize";
export interface CouncilEstimate {
  mode: CouncilEstimateMode;
  label: "estimate";
  calls: number;
  estimatedCostCents: { low: number; high: number } | null;
  unpricedSeats: number;
  estimatedSeconds: { low: number; high: number };
  seats: Array<{ seatId: string; label: string; kind: "model" | "agent"; calls: number; estimatedCostCents: number | null; basis: "history" | "none" }>;
}

export const councilApi = {
  getBrief: (companyId: string, issueId: string) => api.get<{ brief: string }>(`/companies/${companyId}/council/rooms/${issueId}/brief`),
  getReliability: (companyId: string, issueId: string) => api.get<CouncilReliability>(`/companies/${companyId}/council/rooms/${issueId}/stats`),
  /** Suggest how to run a question (heuristic, no model call, no cost). */
  classify: (companyId: string, text: string) => api.post<CouncilModeSuggestion>(`/companies/${companyId}/council/classify`, { text }),
  getEstimate: (companyId: string, roomId: string, mode: CouncilEstimateMode) => api.get<CouncilEstimate>(`/companies/${companyId}/council/rooms/${roomId}/estimate?mode=${mode}`),
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
      order?: CouncilRoundOrder;
      style?: CouncilRoundStyle;
      seatId?: string;
      images?: Array<{ mediaType: string; data: string }>;
      maxOutputTokens?: number;
      clarify?: boolean;
      /** Ask seats to end a discussion reply with a stance so the server can score agreement. */
      stance?: boolean;
      /** After a fast confident agreement, one seat argues the other side. */
      dissent?: boolean;
      /** Seats rank each other's answers blind after an ask round. */
      ranking?: boolean;
      /** Seats vote pass / revise / fail on the best answer. */
      jury?: boolean;
      /** Random panel: only `size` seats answer, picked at random with one per connection first and a persona each. */
      panel?: { size: number; seed: number };
      roundNumber?: number;
      maxRounds?: number;
    },
    signal?: AbortSignal,
  ) =>
    api.post<CouncilRoundResult>(
      `/companies/${companyId}/council/rooms/${issueId}/rounds`,
      {
        ...(input.message ? { message: input.message } : {}),
        mode: input.mode ?? "ask",
        ...(input.order ? { order: input.order } : {}),
        ...(input.style ? { style: input.style } : {}),
        ...(input.seatId ? { seatId: input.seatId } : {}),
        ...(input.images?.length ? { images: input.images } : {}),
        ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
        ...(input.clarify ? { clarify: true } : {}),
        ...(input.stance ? { stance: true } : {}),
        ...(input.ranking ? { ranking: true } : {}),
        ...(input.jury ? { jury: true } : {}),
        ...(input.panel ? { panel: input.panel } : {}),
        ...(input.dissent ? { dissent: true, roundNumber: input.roundNumber, maxRounds: input.maxRounds } : {}),
      },
      { signal },
    ),
  /** Work session: the chair plans steps, seats carry them out, the summary lands in the thread. */
  startWork: (companyId: string, issueId: string, input: { goal: string; decision?: string; postGoal?: boolean; createTasks?: boolean }) =>
    api.post<{ started: boolean }>(`/companies/${companyId}/council/rooms/${issueId}/work`, input),
  getWork: (companyId: string, issueId: string) =>
    api.get<CouncilWorkState>(`/companies/${companyId}/council/rooms/${issueId}/work`),
  stopWork: (companyId: string, issueId: string) =>
    api.post<{ stopped: boolean }>(`/companies/${companyId}/council/rooms/${issueId}/work/stop`, {}),
};

export interface CouncilWorkState {
  status: "idle" | "running" | "done" | "partial" | "failed" | "cancelled";
  steps: Array<{ n: number; title: string; expected: string; assignee: string; status: "pending" | "running" | "done" | "failed"; error?: string }>;
  summary?: string | null;
}

export interface CouncilModeSuggestion {
  kind: "quick-fact" | "decision" | "brainstorm" | "review" | "plan-and-do";
  mode: "ask" | "discuss";
  rounds: number;
  seats: { min: number; max: number };
  autoSummary: boolean;
  dissentCheck: boolean;
  peerRanking: boolean;
  workSession: boolean;
  template: "quick-check" | "balanced-debate" | "decision" | "red-team" | null;
  reason: string;
}
