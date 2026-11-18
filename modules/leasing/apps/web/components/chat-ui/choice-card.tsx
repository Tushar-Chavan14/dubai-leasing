"use client";

import Link from "next/link";

export interface ChoiceOptionView {
  key: string;
  label: string;
  /** Opens a page instead of sending anything (staff chat only). */
  href?: string | undefined;
}

const CHOICE =
  "flex min-h-12 w-full cursor-pointer items-center rounded-xl border border-line bg-page px-4 py-3 text-start font-sans text-[15px] leading-snug font-medium text-ink! transition-colors duration-150 ease-out hover:border-ink hover:bg-raised disabled:cursor-default disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink motion-reduce:transition-none";

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
    <div className="mt-1 grid w-[min(100%,360px)] gap-2" role="group" aria-label={question}>
      {options.map((o) =>
        o.href && !disabled ? (
          <Link key={o.key} href={o.href} className={CHOICE} dir="auto">
            {o.label}
          </Link>
        ) : (
          <button key={o.key} type="button" className={CHOICE} dir="auto" disabled={disabled} onClick={() => onPick(o)}>
            {o.label}
          </button>
        ),
      )}
      <button
        type="button"
        className="w-fit cursor-pointer border-0 bg-transparent px-1 py-1.5 font-sans text-sm font-medium text-muted underline underline-offset-4 hover:text-ink disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ink"
        disabled={disabled}
        onClick={onOther}
      >
        {otherLabel}
      </button>
    </div>
  );
}
