import type { ReactNode, SyntheticEvent } from "react";

export const TOOL_BTN =
  "inline-flex h-[34px] min-w-[34px] cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 bg-transparent px-1.5 text-muted shadow-none hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 data-[recording]:text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink";
export const SEND_BTN =
  "grid size-[34px] cursor-pointer place-items-center rounded-full border-0 bg-cta p-0 text-on-cta disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
/** The text field inside the composer card: bare, so the card draws the border and focus. */
export const FIELD_BARE =
  "max-h-36 min-h-6 w-full resize-none !rounded-none !border-0 !bg-transparent !p-0 font-sans text-sm leading-normal text-ink !shadow-none !outline-none [field-sizing:content] placeholder:text-muted focus:!shadow-none focus-visible:!shadow-none";
/** A starter or suggestion chip in the empty state of the agent panel. */
export const CHIP =
  "cursor-pointer rounded-full border border-line bg-page px-3 py-1.5 text-left font-sans text-[12.5px] leading-snug text-ink hover:border-ink data-[kind=draft]:border-dashed data-[kind=prepare]:border-dashed";

/**
 * The composer card both chats share: a rounded card with the field on top, tools bottom left and the round send button
 * bottom right. Anything passed as `below` (quick-action pills, suggestion chips) sits under the card.
 */
export function ComposerCard({
  onSubmit,
  field,
  tools,
  send,
  below,
}: {
  onSubmit: (e: SyntheticEvent) => void;
  field: ReactNode;
  tools?: ReactNode;
  send: ReactNode;
  below?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-2.5 px-3 pb-1 pt-2">
      <form
        onSubmit={onSubmit}
        className="rounded-[18px] border border-line bg-page py-2.5 pl-4 pr-2.5 focus-within:border-ink"
      >
        {field}
        <div className="mt-1.5 flex items-center justify-between">
          <div className="flex items-center gap-0.5 [&_.vm-pop]:!end-auto [&_.vm-pop]:!start-0">{tools}</div>
          {send}
        </div>
      </form>
      {below}
    </div>
  );
}
