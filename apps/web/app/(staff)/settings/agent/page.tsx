import type { Metadata } from "next";
import {
  AUTOPILOT_GROUPS,
  AUTOPILOT_LIMIT_NUMBERS,
  AUTOPILOT_NUMBERS,
  AUTOPILOT_STEPS,
  DEFAULT_AUTOPILOT,
  DEFAULT_AUTOPILOT_NUMBERS,
  LOCKED_STEPS,
} from "@leasing/core";
import { PageHead } from "../../../../components/ui";
import { get } from "../../../../lib/engine";
import type { Me } from "../../../../lib/types";
import { AgentForm } from "./agent-form";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage() {
  const [policy, me] = await Promise.all([
    get<{ autopilot?: Record<string, boolean | number> }>("/api/policy"),
    get<Me>("/api/me"),
  ]);
  return (
    <>
      <PageHead
        title="Agent"
        lede="What the leasing agent may do without asking you first. Anything you switch off waits for an officer instead."
      />
      <AgentForm
        groups={AUTOPILOT_GROUPS}
        steps={AUTOPILOT_STEPS}
        numbers={AUTOPILOT_NUMBERS}
        limitNumbers={AUTOPILOT_LIMIT_NUMBERS}
        locked={LOCKED_STEPS}
        values={{ ...DEFAULT_AUTOPILOT, ...DEFAULT_AUTOPILOT_NUMBERS, ...policy?.autopilot }}
        canEdit={me?.role === "admin"}
      />
    </>
  );
}
