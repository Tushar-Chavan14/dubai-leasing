"use client";

import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { buttonClass } from "@platform/ui/button";
import { COMPOSE_EMAIL } from "../../../components/work-forms";

/** Opens the record's email form further down (it scrolls into view). Sending stays in that form. */
export function EmailButton({ who }: { who: "applicant" | "tenant" }) {
  return (
    <button
      type="button"
      className={buttonClass("primary", "sm")}
      onClick={() => window.dispatchEvent(new Event(COMPOSE_EMAIL))}
    >
      <EnvelopeSimpleIcon size={15} weight="bold" aria-hidden />
      Email {who}
    </button>
  );
}
