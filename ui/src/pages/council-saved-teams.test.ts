// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import type { CouncilSeat } from "../api/council";
import { deleteTeam, loadTeams, saveTeam, serializeTeam } from "./council-saved-teams";

const seat = { id: "seat-id", issueId: "room-id", name: "Alpha", connectionId: "connection", grantId: "grant", model: "model", role: "critic", persona: "helpful", secret: "secret" } as unknown as CouncilSeat;
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); loadTeams(); });
it("copies only reusable seat fields", () => {
  const team = serializeTeam(" Team ", [seat]);
  expect(team.name).toBe("Team");
  expect(team.seats).toEqual([{ name: "Alpha", connectionId: "connection", grantId: "grant", model: "model", role: "critic", persona: "helpful" }]);
});
it("deduplicates trimmed names and keeps at most twelve teams", () => {
  saveTeam(serializeTeam(" Team ", [seat]));
  saveTeam(serializeTeam("team", [seat]));
  expect(loadTeams()).toHaveLength(1);
  for (let i = 0; i < 13; i++) saveTeam(serializeTeam(`Team ${i}`, [seat]));
  expect(loadTeams()).toHaveLength(12);
});
it("works in memory when storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  const team = serializeTeam("Team", [seat]);
  saveTeam(team);
  expect(loadTeams()).toEqual([team]);
  deleteTeam(team.id);
  expect(loadTeams()).toEqual([]);
});
