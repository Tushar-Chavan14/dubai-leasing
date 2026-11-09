import type { Metadata } from "next";
import { AskAiMenu } from "../../../../components/ask-ai";
import { askPrompts } from "../../../../lib/ask-ai/prompts";
import {
  AUTOPILOT_GROUPS,
  AUTOPILOT_LIMIT_NUMBERS,
  AUTOPILOT_NUMBERS,
  AUTOPILOT_STEPS,
  DEFAULT_AUTOPILOT,
  DEFAULT_AUTOPILOT_NUMBERS,
  LOCKED_STEPS,
} from "@leasing/core";
import { SetPage } from "../../../../components/ui/settings";
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
    <SetPage
      title="Agent"
      lede="Choose how much the agent does by itself. Anything you switch off waits for an officer instead. It never approves, sends or signs anything."
      actions={<AskAiMenu label="Ask AI" prompts={askPrompts.settingsPage("Agent")} />}
      max="max-w-[760px]"
    >
      <AgentForm
        groups={AUTOPILOT_GROUPS}
        steps={AUTOPILOT_STEPS}
        numbers={AUTOPILOT_NUMBERS}
        limitNumbers={AUTOPILOT_LIMIT_NUMBERS}
        locked={LOCKED_STEPS}
        values={{ ...DEFAULT_AUTOPILOT, ...DEFAULT_AUTOPILOT_NUMBERS, ...policy?.autopilot }}
        canEdit={me?.role === "admin"}
      />
    </SetPage>
  );
}
