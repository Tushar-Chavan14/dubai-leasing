import { STATUS_STAGES } from "@leasing/core";

export interface StepperStage {
  name: string;
  state: "done" | "current" | "todo";
}

/** Where each Workspace stage sits on the five-step tracker (null: not started; STATUS_STAGES.length: all done). */
const STAFF_STAGE_STEP: Record<string, number | null> = {
  Enquiry: null,
  Viewing: 0,
  Documents: 1,
  Offer: 2,
  // The offer is accepted and paid; the lease is being created for the contract.
  Reserved: 3,
  Contract: 3,
  Ejari: 4,
  Registered: STATUS_STAGES.length,
};

/** The tracker for a Workspace stage name: past steps done, the current one marked, the rest to do. */
export function stagesForStaffStage(stage: string): StepperStage[] {
  const step = STAFF_STAGE_STEP[stage] ?? null;
  return STATUS_STAGES.map((name, i) => ({
    name,
    state: step === null || i > step ? "todo" : i === step ? "current" : "done",
  }));
}
