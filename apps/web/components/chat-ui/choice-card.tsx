"use client";

import Link from "next/link";

export interface ChoiceOptionView {
  key: string;
  label: string;
  /** Opens a page instead of sending anything (staff chat only). */
  href?: string | undefined;
}

/**
 * A choice card: a question's options as large tap targets, shared by both chats. A tap only
 * sends text or opens a page; it never carries an action. "Type something else" focuses the box.
 */
export function ChoiceCardView({
  question,
  options,
  disabled,
  onPick,
  otherLabel = "Type something else",
  onOther,
}: {
  question: string;
  options: ChoiceOptionView[];
  disabled: boolean;
  onPick: (o: ChoiceOptionView) => void;
  otherLabel?: string;
  onOther: () => void;
}) {
  return (
    <div className="cc-choices" role="group" aria-label={question}>
      {options.map((o) =>
        o.href && !disabled ? (
          <Link key={o.key} href={o.href} className="cc-choice" dir="auto">
            {o.label}
          </Link>
        ) : (
          <button
            key={o.key}
            type="button"
            className="cc-choice"
            dir="auto"
            disabled={disabled}
            onClick={() => onPick(o)}
          >
            {o.label}
          </button>
        ),
      )}
      <button type="button" className="cc-choice-other" disabled={disabled} onClick={onOther}>
        {otherLabel}
      </button>
    </div>
  );
}
