// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isStale, lastCheck, rememberCheck } from "./council-check-memory";

describe("council check memory", () => {
  beforeEach(() => sessionStorage.clear());
  it("stores checks separately by room and filters removed seats", () => {
    const check = rememberCheck("room", { a: { ok: true, seconds: 1.3 }, b: { ok: false, error: "Offline" } });
    rememberCheck("other", { c: { ok: true } });
    expect(lastCheck("room")).toEqual(check);
    expect(lastCheck("room", ["a"])).toEqual({ ...check, seats: { a: { ok: true, seconds: 1.3 } } });
    expect(lastCheck("missing")).toBeNull();
  });
  it("expires after thirty minutes", () => {
    const check = { at: 1000, seats: {} };
    expect(isStale(check, 1000 + 30 * 60_000 - 1)).toBe(false);
    expect(isStale(check, 1000 + 30 * 60_000)).toBe(true);
    expect(isStale(check, 2000, 1000)).toBe(true);
  });
  it("handles blocked storage", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => rememberCheck("room", { a: { ok: true } })).not.toThrow();
    expect(lastCheck("room")).toBeNull();
    get.mockRestore();
  });
});
