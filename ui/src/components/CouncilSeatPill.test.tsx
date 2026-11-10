// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { CouncilSeatStatusDot, councilSeatLocation, councilSeatMayUseCloud } from "./CouncilSeatPill";

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

describe("councilSeatMayUseCloud", () => {
  it.each(["groq", "nvidia", "gemini", "openai", "unknown"])("warns for %s", (provider) => {
    expect(councilSeatMayUseCloud({ provider })).toBe(true);
  });
  it("does not warn for ollama", () => {
    expect(councilSeatMayUseCloud({ provider: "ollama" })).toBe(false);
  });
});


it("renders checked status dots and leaves unchecked seats without a dot", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<><CouncilSeatStatusDot status={{ ok: true, seconds: 1.3 }} /><CouncilSeatStatusDot status={{ ok: false, error: "Connection failed" }} /><CouncilSeatStatusDot /></>));
  expect(container.querySelectorAll('[role="img"]')).toHaveLength(2);
  expect(container.querySelector('[title="Worked in the last check, 1.3s"]')?.className).toContain("status-task-icon-done");
  expect(container.querySelector('[title="Connection failed"]')?.className).toContain("bg-destructive");
  await act(async () => root.unmount());
});
