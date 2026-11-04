import type { Issue } from "@paperclipai/shared";
import { api } from "./client";

export interface CouncilSeatFallback {
  connectionId: string;
  grantId: string;
  model: string;
}

export interface CouncilSeat {
  id: string;
  issueId: string;
  name: string;
  persona: string;
  connectionId: string;
  grantId: string;
  model: string;
  reasoningEffort: string | null;
  acceptsImages: boolean;
  fallbacks: CouncilSeatFallback[];
  active: boolean;
  position: number;
}

export interface CouncilSeatInput {
  name: string;
  persona?: string;
  connectionId: string;
  grantId: string;
  model: string;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  acceptsImages?: boolean;
  fallbacks?: CouncilSeatFallback[];
}

export interface CouncilSeatResult {
  seatId: string;
  seatName: string;
  model?: string;
  failedAttempts?: Array<{ model: string; error: string }>;
  status: "ok" | "error" | "blocked";
  commentId?: string;
  text?: string;
  error?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number;
}

export interface CouncilRoundResult {
  roundId: string;
  userCommentId: string | null;
  results: CouncilSeatResult[];
}

export const councilApi = {
  listRooms: (companyId: string) => api.get<Issue[]>(`/companies/${companyId}/council/rooms`),
  createRoom: (companyId: string, title: string) => api.post<Issue>(`/companies/${companyId}/council/rooms`, { title }),
  listSeats: (companyId: string, issueId: string) =>
    api.get<CouncilSeat[]>(`/companies/${companyId}/council/rooms/${issueId}/seats`),
  addSeat: (companyId: string, issueId: string, input: CouncilSeatInput) =>
    api.post<CouncilSeat>(`/companies/${companyId}/council/rooms/${issueId}/seats`, input),
  removeSeat: (companyId: string, issueId: string, seatId: string) =>
    api.delete(`/companies/${companyId}/council/rooms/${issueId}/seats/${seatId}`),
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
      },
      { signal },
    ),
};
