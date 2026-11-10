import { describe, expect, it } from "vitest";
import { friendlySeatError } from "../services/council-seat-errors.js";

describe("friendlySeatError", () => {
  it.each([
    ["Empty answer", "The model returned an empty response. Thinking models can use up the answer limit; raise it in Settings or try another model."],
    ["401 unauthorized", "The connection was refused (wrong or expired key). Check the connection's credentials."],
    ["404 model not found", "That model is not available on this connection. Pick another model."],
    ["429 quota", "The provider is rate limiting this connection. Wait a minute or switch seat to another model."],
    ["ETIMEDOUT", "The model took too long to answer. Try again or pick a faster model."],
    ["fetch failed", "Could not reach the provider. Check the connection."],
    ["maximum context exceeded", "The conversation is too long for this model. Clear the chat or use a larger-context model."],
    ["503 service unavailable", "The provider had a temporary problem. Try again."],
    ["Budget limit reached", "Budget limit reached"],
    ["The model `x-9000` does not exist or you do not have access to it.", "That model is not available on this connection. Pick another model."],
    ["Developer instruction is not enabled for models/antigravity", "This model does not support what the room asked for. Pick another model."],
    ["Agent turn failed", "The agent could not finish its turn. Check that the agent is running (Agents page) and that its gateway is reachable."],
    ["Council agent returned an empty reply", "The agent finished without writing a reply. Try again or check its instructions."],
  ])("formats %s", (raw, expected) => {
    expect(friendlySeatError(raw)).toBe(expected);
  });

  it("identifies an unreachable local server", () => {
    expect(friendlySeatError("ECONNREFUSED", { local: true })).toBe("Could not reach the local model server. Is Ollama running?");
  });

  it("cleans and limits unknown errors", () => {
    const result = friendlySeatError(`${"x".repeat(180)}\n    at secretStack (file.ts:1)`);
    expect(result).toBe(`The model call failed: ${"x".repeat(160)}. Try again.`);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it.each(["Bearer sk-abc123", "?key=AIzaExample123", "https://example.com/?key=AIzaExample123"])("redacts credentials in %s", (secret) => {
    const result = friendlySeatError(`Unexpected problem ${secret}\n    at stack (file.ts:1)`);
    expect(result).not.toContain("sk-abc123");
    expect(result).not.toContain("AIzaExample123");
    expect(result).not.toContain("at stack");
  });
});
