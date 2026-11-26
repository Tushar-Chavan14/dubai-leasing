import { Pill } from "@platform/ui/pill";
import { ROW_CARD, Section, Sub } from "@platform/ui/record";
import type { AgreementReviewSection, AgreementReviewView } from "../lib/contracts";

const KIND: Record<
  AgreementReviewSection["review"]["flags"][number]["kind"],
  { text: string; tone: "warning" | "danger" }
> = {
  conflict: { text: "Conflict", tone: "warning" },
  unknown_amount: { text: "Amount that is not this deal's", tone: "warning" },
  unknown_date: { text: "Date that is not this deal's", tone: "warning" },
  instruction_like: { text: "Reads like an instruction", tone: "danger" },
};
const DOCUMENT: Record<string, string> = { spa: "SPA", mou: "MOU", assignment: "Assignment" };
const STATUS_TONE = {
  ready: "accent",
  pending: "neutral",
  held: "waiting",
  unavailable: "warning",
  off: "neutral",
} as const;

/**
 * The review's status, note and flags (C25, S60), each flag quoting words that are in the agreement or in the offer's
 * conditions. Advice only: it never blocks, approves or edits the agreement, so there is no control here. A review that
 * is running, waiting for a person, switched off or failed says so and shows no flag. Used on the record and on the
 * `agreement_approval` card (S63).
 */
export function ReviewBody({ review }: { review: AgreementReviewView }) {
  return (
    <div className="grid gap-2">
      <span className="flex flex-wrap items-center gap-2">
        <Pill tone={STATUS_TONE[review.status]}>{review.label}</Pill>
      </span>
      <Sub>{review.note}</Sub>
      {review.status === "ready" &&
        (review.flags.length ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {review.flags.map((f) => (
              <li key={`${f.kind}-${f.in}-${f.quote}`} className={`${ROW_CARD} m-0 grid gap-1`}>
                <span className="flex flex-wrap items-center gap-2">
                  <Pill tone={KIND[f.kind].tone}>{KIND[f.kind].text}</Pill>
                  <Sub>{f.in === "agreement" ? "In the agreement" : "In the offer's conditions"}</Sub>
                </span>
                <blockquote className="m-0 border-l-2 border-line pl-3 [overflow-wrap:anywhere]">
                  &ldquo;{f.quote}&rdquo;
                </blockquote>
                <Sub>{f.note}</Sub>
                <Sub>{f.source === "code" ? "Found by a rule" : "Suggested by the helper"}</Sub>
              </li>
            ))}
          </ul>
        ) : (
          <Sub>Nothing to flag.</Sub>
        ))}
      {review.status === "ready" && review.dropped > 0 && (
        <Sub>
          {review.dropped === 1
            ? "1 suggestion left out because its words were not in the text"
            : `${review.dropped} suggestions left out because their words were not in the text`}
        </Sub>
      )}
    </div>
  );
}

/** The agreement review on the deal record. */
export function AgreementReview({ section }: { section: AgreementReviewSection }) {
  const { agreement, review } = section;
  return (
    <Section
      id="agreement-review"
      title="Agreement review"
      hint={`Agreement v${agreement.version} · ${DOCUMENT[agreement.kind] ?? agreement.kind}`}
    >
      <ReviewBody review={review} />
    </Section>
  );
}
