import { Pill } from "@platform/ui/pill";
import type { StageKey } from "@spa/core";
import { stageTone } from "../lib/work";

/** A deal's stage as a pill in the words staff see (design §6.1, §6.2). The label always comes from the engine. */
export function StateBadge({ stage, label }: { stage: StageKey; label: string }) {
  return <Pill tone={stageTone(stage)}>{label}</Pill>;
}
