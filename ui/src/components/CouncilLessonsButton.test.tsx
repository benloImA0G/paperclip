// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CouncilLessonsButton } from "./CouncilLessonsButton";
const mock = vi.hoisted(() => ({ extractLessons: vi.fn(), pushToast: vi.fn() }));
vi.mock("../api/memory", () => ({ memoryApi: mock }));
vi.mock("../context/ToastContext", () => ({ useOptionalToastActions: () => ({ pushToast: mock.pushToast }) }));
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>; let client: QueryClient;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.unstubAllGlobals(); });
describe("CouncilLessonsButton", () => {
  for (const [result, title] of [[{ created: [{}], skipped: 0 }, "Found 1 lessons - approve them in Memory"], [{ created: [], skipped: 0 }, "Nothing new to learn"], [{ created: [], skipped: 0, reason: "Room is empty" }, "Room is empty"]] as const) {
    it(`shows ${title}`, async () => { mock.extractLessons.mockResolvedValue(result); await act(async () => root.render(<QueryClientProvider client={client}><CouncilLessonsButton companyId="c" issueId="i" /></QueryClientProvider>)); await act(async () => { container.querySelector("button")!.click(); await new Promise((resolve) => setTimeout(resolve, 10)); }); expect(mock.extractLessons).toHaveBeenCalledWith("c", "i"); expect(mock.pushToast).toHaveBeenCalledWith(expect.objectContaining({ title })); if (result.created.length) expect(mock.pushToast).toHaveBeenCalledWith(expect.objectContaining({ action: { label: "Open Memory", href: "/memory" } })); });
  }
});
