import { describe, expect, it } from "vitest";
import { mentionedSeatIds, seatProgress } from "./council-seat-progress";

const activeSeats = [{ id: "a", name: "Smoke A" }, { id: "b", name: "Smoke B" }];
const base = { activeSeats, comments: [], roundStartedAt: 1000, now: 3000 };
describe("seat progress", () => {
  it("starts with all seats waiting", () => expect(seatProgress(base).seats.map((s) => s.status)).toEqual(["waiting", "waiting"]));
  it("counts only replies from this round", () => expect(seatProgress({ ...base, comments: [{ authorUserId: "council-seat:a", createdAt: new Date(999) }, { authorUserId: "council-seat:b", createdAt: new Date(1000) }] }).seats.map((s) => s.status)).toEqual(["waiting", "answered"]));
  it("limits progress to mentioned seats", () => expect(seatProgress({ ...base, targetedSeatIds: mentionedSeatIds("Hello @Smoke B", activeSeats) }).seats.map((s) => s.id)).toEqual(["b"]));
  it("puts the orchestrator last in a chain", () => {
    const seats = [{ id: "chair", name: "Chair", role: "moderator" }, { id: "a", name: "A" }, { id: "b", name: "B" }];
    expect(seatProgress({ ...base, activeSeats: seats }).current?.id).toBe("a");
    const done = [{ authorUserId: "council-seat:a", createdAt: new Date(1000) }, { authorUserId: "council-seat:b", createdAt: new Date(1000) }];
    expect(seatProgress({ ...base, activeSeats: seats, comments: done }).current?.id).toBe("chair");
  });
  it("exposes the first waiting seat for a chain", () => expect(seatProgress({ ...base, comments: [{ authorUserId: "council-seat:a", createdAt: new Date(1000) }] }).current?.id).toBe("b"));
});
