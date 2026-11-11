// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CouncilAnswerStyle, CouncilSetting, CouncilSettingsPanel } from "./CouncilSettingsPanel";

it("shows the three groups and descriptions, and selects chain", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const changed = vi.fn();
  function Example() {
    const [style, setStyle] = useState<"side-by-side" | "chain">("side-by-side");
    return <CouncilSettingsPanel who={<CouncilSetting description="Choose seats.">Seats</CouncilSetting>} how={<CouncilSetting description="Choose how seats answer."><CouncilAnswerStyle value={style} onChange={(value) => { setStyle(value); changed(value); }} /></CouncilSetting>} extras={<CouncilSetting description="Protect exports.">Exports</CouncilSetting>} />;
  }
  await act(async () => root.render(<Example />));
  expect([...container.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual(["Who answers", "How they talk", "Safety and extras"]);
  const settings = container.firstElementChild as HTMLElement;
  expect(settings.classList.contains("min-w-0")).toBe(true);
  expect(settings.className).toContain("[&_select]:max-w-full");
  expect(container.querySelector("[aria-label='How they talk']")?.classList.contains("min-w-0")).toBe(true);
  for (const description of ["Choose seats.", "Choose how seats answer.", "Protect exports."]) expect(container.textContent).toContain(description);
  const select = container.querySelector("select")!;
  expect(select.value).toBe("side-by-side");
  await act(async () => { select.value = "chain"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(changed).toHaveBeenCalledWith("chain");
  await act(async () => root.unmount());
  container.remove();
});

it("keeps advanced controls closed by default and remembers opening them", async () => {
  localStorage.removeItem("council-settings-advanced-open");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const changeRounds = vi.fn();
  const changeStyle = vi.fn();
  const panel = <CouncilSettingsPanel who={<CouncilSetting description="Choose how many seats answer, or let everyone answer."><label>Random panel<select aria-label="Random panel"><option>Everyone</option></select></label></CouncilSetting>} how={<><CouncilSetting description="Choose how many rounds of discussion follow the first answers."><select aria-label="Rounds" value="off" onChange={changeRounds}><option value="off">No debate</option><option value="low">One round</option></select></CouncilSetting><CouncilSetting description="Choose whether seats cooperate or challenge each other."><select aria-label="Discussion style" value="collaborate" onChange={changeStyle}><option value="collaborate">Collaborate</option></select></CouncilSetting><CouncilSetting description="Other seats grade each work step."><button>Jury checks</button></CouncilSetting></>} extras={<CouncilSetting description="Ask for approval before downloading exports.">Approval</CouncilSetting>} />;
  await act(async () => root.render(panel));
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain("Jury checks");
  expect(details.textContent).toContain("Most people never need these. The defaults work.");
  expect(details.querySelector("h4")?.textContent).toBe("Check the work");
  expect(container.textContent).toContain("Answer style is set above the message box.");
  const combined = container.querySelector<HTMLSelectElement>('select[aria-label="How seats answer"]')!;
  await act(async () => { combined.value = "challenge"; combined.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(changeStyle.mock.calls[0][0].target.value).toBe("challenge");
  expect(changeRounds.mock.calls[0][0].target.value).toBe("low");
  await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
  expect(localStorage.getItem("council-settings-advanced-open")).toBe("true");
  await act(async () => root.unmount());
  container.remove();
  localStorage.removeItem("council-settings-advanced-open");
});
