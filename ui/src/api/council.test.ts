import { describe, expect, it, vi } from "vitest";
import { councilApi } from "./council";
import { api } from "./client";

vi.mock("./client", () => ({ api: { post: vi.fn() }, requestResponse: vi.fn() }));

describe("councilApi.forkRoom", () => {
  it("posts the selected comment to the room fork endpoint", () => {
    councilApi.forkRoom("company", "room", "comment");
    expect(api.post).toHaveBeenCalledWith("/companies/company/council/rooms/room/fork", { upToCommentId: "comment" });
  });
});

describe("councilApi.runRound", () => {
  it("sends the selected reply when asking again", () => {
    councilApi.runRound("company", "room", { seatId: "seat", repeatLast: true, repeatFromCommentId: "comment" });
    expect(api.post).toHaveBeenCalledWith("/companies/company/council/rooms/room/rounds", { mode: "ask", seatId: "seat", repeatLast: true, repeatFromCommentId: "comment" }, expect.anything());
  });
});
