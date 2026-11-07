import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { proposeSeats } from "../services/council-autofill.js";

const mocks = vi.hoisted(() => ({ getRoom: vi.fn(), listSeats: vi.fn(), listModels: vi.fn(), list: vi.fn() }));
vi.mock("../services/council-chat.js", () => ({ COUNCIL_ORIGIN_KIND: "council", councilChatService: () => mocks }));
vi.mock("../services/ai-connections.js", () => ({ aiConnectionService: () => ({ list: mocks.list }) }));
vi.mock("../routes/authz.js", () => ({ assertCompanyAccess: vi.fn(), getActorInfo: () => ({ actorType: "user", actorId: "alice" }) }));

const candidates = [
  { connectionId: "a", vendor: "alpha", model: "one", name: "one" },
  { connectionId: "a", vendor: "alpha", model: "two", name: "two" },
  { connectionId: "b", vendor: "beta", model: "one", name: "one" },
  { connectionId: "b", vendor: "beta", model: "two", name: "two" },
  { connectionId: "c", vendor: "gamma", model: "one", name: "one" },
];
describe("proposeSeats", () => {
  it("skips models that are not chat models", () => {
    const result = proposeSeats(
      [
        { connectionId: "a", vendor: "alpha", model: "nemotron-parse-2.0", name: "x" },
        { connectionId: "a", vendor: "alpha", model: "lyria-3.5", name: "x" },
        { connectionId: "a", vendor: "alpha", model: "text-embedding-3", name: "x" },
        { connectionId: "a", vendor: "alpha", model: "gemini-flash-lite", name: "x" },
      ],
      [],
      { count: 4, seed: 1 },
    );
    expect(result.map((seat) => seat.model)).toEqual(["gemini-flash-lite"]);
  });
  it("treats two connections of the same provider type as different vendors", () => {
    const result = proposeSeats(
      [
        { connectionId: "nvidia", vendor: "openai", model: "m1", name: "m1" },
        { connectionId: "nvidia", vendor: "openai", model: "m2", name: "m2" },
        { connectionId: "ollama", vendor: "openai", model: "g1", name: "g1" },
      ],
      [],
      { count: 2, seed: 5 },
    );
    expect(new Set(result.map((seat) => seat.connectionId)).size).toBe(2);
  });
  it("cycles through vendors before repeating them", () => {
    const result = proposeSeats(candidates, [], { count: 5, seed: 3 });
    expect(new Set(result.slice(0, 3).map((seat) => seat.vendor)).size).toBe(3);
    expect(new Set(result.slice(3).map((seat) => seat.vendor)).size).toBe(2);
  });
  it("is deterministic for a seed", () => {
    expect(proposeSeats(candidates, [], { count: 5, seed: 42 })).toEqual(proposeSeats(candidates, [], { count: 5, seed: 42 }));
  });
  it("excludes seated and duplicate vendor models and unusable candidates", () => {
    const result = proposeSeats([...candidates, candidates[0]!, { ...candidates[1]!, model: "disabled", usable: false }], [{ vendor: "ALPHA", model: "one" }], { count: 8, seed: 1 });
    expect(result).toHaveLength(4);
    expect(result.some((seat) => seat.vendor === "alpha" && seat.model === "one")).toBe(false);
    expect(result.some((seat) => seat.model === "disabled")).toBe(false);
  });
  it("returns only available candidates and handles an empty pool", () => {
    expect(proposeSeats(candidates, [], { count: 8, seed: 1 })).toHaveLength(5);
    expect(proposeSeats([], [], { count: 8, seed: 1 })).toEqual([]);
  });
});
it("suggests seats through the board route without creating them", async () => {
  mocks.getRoom.mockResolvedValue({});
  mocks.listSeats.mockResolvedValue([]);
  mocks.list.mockResolvedValue([{ id: "a", grantId: "grant", provider: "alpha", method: "api_key", ownership: "shared", status: "connected" }]);
  mocks.listModels.mockResolvedValue(["one"]);
  const { councilChatRoutes } = await import("../routes/council-chat.js");
  const app = express();
  app.use(express.json());
  app.use("/api", councilChatRoutes({} as never));
  app.use((error: { status?: number; message?: string }, _req: unknown, res: express.Response, _next: unknown) => res.status(error instanceof ZodError ? 400 : error.status ?? 500).json({ error: error.message }));
  const response = await request(app).post("/api/companies/company/council/rooms/room/seats/suggest").send({ count: 1, seed: 3 });
  expect(response.status).toBe(200);
  expect(response.body.proposals).toEqual([{ connectionId: "a", vendor: "alpha", model: "one", name: "one" }]);
  expect(mocks.getRoom).toHaveBeenCalledWith("company", "room");
  const invalid = await request(app).post("/api/companies/company/council/rooms/room/seats/suggest").send({ count: 9 });
  expect(invalid.status).toBe(400);
}, 30_000);
