import { Panel } from "@platform/ui/settings";
import { Pill } from "@platform/ui/pill";
import { Sub } from "@platform/ui/record";
import type { HelperSettings } from "../lib/contracts";
import { shortDate } from "../lib/format";

const MODES = [
  { value: "auto", label: "Auto" },
  { value: "review", label: "Review" },
  { value: "off", label: "Off" },
] as const;

const KIND_WORDS: Record<string, string> = {
  noc: "NOC",
  liability_letter: "Liability letter",
  release_letter: "Release letter",
  pre_approval: "Pre-approval",
  final_offer: "Final offer letter",
  trade_licence: "Trade licence",
  memorandum: "Memorandum",
  poa: "Power of attorney",
  board_resolution: "Board resolution",
  title_deed: "Title deed",
  oqood: "Oqood certificate",
  payment_receipt: "Payment receipt",
};
const scopeWords = (s: string) => (s === "*" ? "Every document" : (KIND_WORDS[s] ?? s));

const BTN =
  "cursor-pointer rounded-full border-0 px-3 py-1.5 font-sans text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** One mode control: three submit buttons in a pill. Read-only: three plain labels, the one in force marked. */
function ModeControl({
  helper,
  scope,
  mode,
  editable,
  action,
  name,
  reviewable = true,
}: {
  helper: string;
  scope: string;
  mode: string;
  editable: boolean;
  /** False: this kind's read holds nothing, so Review isn't offered. */
  reviewable?: boolean;
  action: (f: FormData) => void | Promise<void>;
  name: string;
}) {
  const modes = MODES.filter((m) => reviewable || m.value !== "review");
  const shell = "inline-flex rounded-full border border-line bg-raised p-0.5";
  if (!editable)
    return (
      <span className={shell} role="radiogroup" aria-label={name}>
        {modes.map((m) => (
          <span
            key={m.value}
            role="radio"
            aria-checked={m.value === mode}
            className={`${BTN} ${m.value === mode ? "bg-primary text-on-primary" : "text-muted"}`}
          >
            {m.label}
          </span>
        ))}
      </span>
    );
  return (
    <form action={action} className={shell} role="radiogroup" aria-label={name}>
      <input type="hidden" name="helper" value={helper} />
      <input type="hidden" name="scope" value={scope} />
      {modes.map((m) => (
        <button
          key={m.value}
          type="submit"
          name="mode"
          value={m.value}
          role="radio"
          aria-checked={m.value === mode}
          className={`${BTN} ${m.value === mode ? "bg-primary text-on-primary" : "bg-transparent text-muted"}`}
        >
          {m.label}
        </button>
      ))}
    </form>
  );
}

/**
 * Settings → AI helpers (C24, S59, design §5). Per helper a mode: Auto (the result counts at once), Review (an ok result
 * waits for a person's click) or Off (the step becomes a task). The model is shown, never set. An admin edits; a sales
 * manager reads. Nothing here mentions a compliance matter: those helpers are not on this screen.
 */
export function HelperSettingsView({
  data,
  action,
}: {
  data: HelperSettings;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div className="grid gap-4">
      <p className="m-0 max-w-[62ch] text-sm text-muted">
        <b className="text-ink">Auto</b>: when the check passes, the deal moves on. <b className="text-ink">Review</b>:
        a passing result waits for a person to click &ldquo;Looks right&rdquo; first. <b className="text-ink">Off</b>:
        the helper does not run and a task tells the agent to do the step by hand. A check that fails always goes to its
        usual person, in every mode.
      </p>
      <Panel>
        <ul className="m-0 grid list-none p-0">
          {data.helpers.map((h) => (
            <li key={h.helper} className="grid gap-3 border-b border-line p-4 last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <b className="block font-semibold">{h.label}</b>
                  <Sub>{h.model ? `Model: ${h.model}` : "No model: code does this step"}</Sub>
                </div>
                {h.settings.length === 1 && (
                  <ModeControl
                    helper={h.helper}
                    scope="*"
                    mode={h.settings[0]!.mode}
                    editable={data.canEdit}
                    action={action}
                    name={`${h.label} mode`}
                  />
                )}
              </div>
              {h.settings.length > 1 && (
                <ul className="m-0 grid list-none gap-2 p-0">
                  {h.settings.map((s) => (
                    <li key={s.scope} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">{scopeWords(s.scope)}</span>
                      <span className="flex items-center gap-2">
                        {s.version > 0 && s.setAt && <Pill tone="accent">Saved {shortDate(s.setAt)}</Pill>}
                        <ModeControl
                          helper={h.helper}
                          scope={s.scope}
                          mode={s.mode}
                          editable={data.canEdit}
                          action={action}
                          name={`${h.label}, ${scopeWords(s.scope)}`}
                          reviewable={!h.reviewScopes || h.reviewScopes.includes(s.scope)}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {h.settings.length === 1 && h.settings[0]!.setAt && (
                <Sub>
                  Saved {shortDate(h.settings[0]!.setAt)}
                  {h.settings[0]!.setBy ? ` by ${h.settings[0]!.setBy}` : ""}, version {h.settings[0]!.version}
                </Sub>
              )}
              {data.canEdit && h.availableScopes.length > 2 && <ReaderKinds helper={h} action={action} />}
            </li>
          ))}
        </ul>
      </Panel>
      <p className="m-0 text-[13px] text-muted">
        {data.canEdit
          ? "Every save is audited and versioned. A job already running keeps the mode it started under."
          : "An admin changes these. Every change is audited and versioned."}{" "}
        A model or prompt change needs its eval to pass. Models are set in the engine&apos;s environment, not here.
      </p>
    </div>
  );
}

/** Adds a per-kind row for the reader: choosing a mode for a kind that has none yet. */
function ReaderKinds({
  helper,
  action,
}: {
  helper: HelperSettings["helpers"][number];
  action: (f: FormData) => void | Promise<void>;
}) {
  const have = new Set(helper.settings.map((s) => s.scope));
  const rest = helper.availableScopes.filter((s) => !have.has(s));
  if (!rest.length) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted">Set a mode for one kind of document</summary>
      <ul className="m-0 mt-2 grid list-none gap-2 p-0">
        {rest.map((s) => (
          <li key={s} className="flex flex-wrap items-center justify-between gap-2">
            <span>{scopeWords(s)}</span>
            <ModeControl
              helper={helper.helper}
              scope={s}
              mode={helper.settings.find((x) => x.scope === "*")?.mode ?? "auto"}
              editable
              action={action}
              name={`${helper.label}, ${scopeWords(s)}`}
              reviewable={!helper.reviewScopes || helper.reviewScopes.includes(s)}
            />
          </li>
        ))}
      </ul>
    </details>
  );
}
