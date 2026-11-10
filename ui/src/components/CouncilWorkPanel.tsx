import { CouncilWorkPanel as WorkPanel } from "../pages/council-work-step";
import type { WorkStep } from "../api/council";

export type CouncilWorkStepView = WorkStep;

/** The council's plan after agreement: numbered steps with who does each and live status. */
export function CouncilWorkPanel({ steps, running }: { steps: CouncilWorkStepView[]; running: boolean }) {
  return <WorkPanel steps={steps} running={running} />;
}
