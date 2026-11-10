import { describe, expect, it } from "vitest";
import { NON_CHAT_MODEL_ID } from "../services/council-chat.js";

describe("NON_CHAT_MODEL_ID", () => {
  it.each([
    "nvidia/nv-embedqa-e5-v5",
    "google/deplot",
    "nvidia/nvclip",
    "nvidia/nemotron-parse",
    "nvidia/llama-3.1-nemotron-70b-reward",
    "nvidia/llama-3.1-nemoguard-8b-content-safety",
    "nvidia/riva-translate-4b-instruct",
    "lyria-3-pro",
    "nano-banana-pro",
    "gemini-robotics-er-1.5",
    "gemini-2.5-computer-use-preview-10-2025",
    "deep-research-pro-preview-12-2025",
    "whisper-large-v3",
  ])("hides %s", (id) => expect(NON_CHAT_MODEL_ID.test(id)).toBe(true));

  it.each([
    "openai/gpt-oss-120b",
    "qwen/qwen3.8-27b",
    "allam-2-7b",
    "gemini-3.5-flash-lite",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    "gemma4:26b",
    "devstral-small-2:24b",
    "meta/llama-3.3-70b-instruct",
  ])("keeps %s", (id) => expect(NON_CHAT_MODEL_ID.test(id)).toBe(false));
});
