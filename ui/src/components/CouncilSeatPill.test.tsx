import { describe, expect, it } from "vitest";
import { councilSeatLocation } from "./CouncilSeatPill";

describe("councilSeatLocation", () => {
  it.each(["ollama", "local"])("identifies %s as local", (provider) => {
    expect(councilSeatLocation({ provider })).toBe("Local");
  });
  it.each(["groq", "nvidia", "gemini", "openai"])("identifies %s as cloud", (provider) => {
    expect(councilSeatLocation({ provider })).toBe("Cloud");
  });
  it("leaves unknown providers unlabelled", () => {
    expect(councilSeatLocation({ provider: "unknown" })).toBeNull();
  });
  it("uses observed reply metadata and routing", () => {
    expect(councilSeatLocation({ local: false, provider: "ollama" })).toBe("Cloud");
    expect(councilSeatLocation({ routingKind: "local" })).toBe("Local");
    expect(councilSeatLocation({ routingKind: "cloud" })).toBe("Cloud");
  });
});
