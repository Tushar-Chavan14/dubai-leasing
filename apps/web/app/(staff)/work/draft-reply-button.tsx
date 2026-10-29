"use client";

import { COPILOT_ASK_EVENT } from "../../../components/copilot/panel";
import { IconSpark } from "../../../lib/icons";
import type { RecordRow } from "../../../lib/types";

/**
 * "Draft a reply" (switch `copilot_proactive_drafts`). It only asks the copilot, on a click, to
 * write a draft. A lease draft is saved through the copilot's `draft_email` tool and opened in the
 * normal email form; nothing is sent by this button or by the copilot.
 */
export function DraftReplyButton({ record }: { record: Pick<RecordRow, "kind" | "ref" | "stage"> }) {
  const text =
    record.kind === "lease"
      ? `Draft a short, polite reminder email to the tenant of lease ${record.ref}, who has not answered yet (stage: ${record.stage}). Use draft_email so I can review it. Do not promise money, dates or legal outcomes.`
      : `Write a short, polite follow-up message for the applicant on application ${record.ref}, who has not answered yet (stage: ${record.stage}). Show the text here for me to copy. Do not promise money, dates or legal outcomes.`;
  return (
    <button
      type="button"
      className="btn small"
      onClick={() => window.dispatchEvent(new CustomEvent(COPILOT_ASK_EVENT, { detail: { text } }))}
    >
      <IconSpark size={14} />
      Draft a reply
    </button>
  );
}
