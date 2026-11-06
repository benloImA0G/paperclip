import { describe, expect, it } from "vitest";
import { roomDescription, roomMetadata } from "../services/council-chat.js";

describe("council room metadata", () => {
  it("keeps a plain brief as plain text when there are no settings", () => {
    expect(roomMetadata("Planning notes")).toMatchObject({
      brief: "Planning notes",
      requireApproval: false,
    });
    expect(roomDescription({ version: 1, brief: "Planning notes", requireApproval: false, kind: null })).toBe("Planning notes");
  });

  it.each([
    ["approval only", { requireApproval: true, kind: null }],
    ["kind only", { requireApproval: false, kind: "review" }],
    ["approval and kind", { requireApproval: true, kind: "plan-and-do" }],
  ] as const)("round trips %s", (_label, values) => {
    const description = roomDescription({ version: 1, brief: "Keep the scope narrow", ...values });
    expect(roomMetadata(description)).toMatchObject({
      version: 1,
      brief: "Keep the scope narrow",
      ...values,
    });
  });

  it("reads legacy plain text and approval metadata without a kind", () => {
    expect(roomMetadata("Older room brief")).toMatchObject({
      brief: "Older room brief",
      requireApproval: false,
    });
    expect(roomMetadata(JSON.stringify({ __councilRoom: 1, brief: "Older structured brief", requireApproval: true }))).toMatchObject({
      brief: "Older structured brief",
      requireApproval: true,
    });
  });
});
