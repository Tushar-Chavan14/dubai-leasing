import { Button } from "@platform/ui/button";
import { Pill } from "@platform/ui/pill";
import { Fact, FactGrid, Section } from "@platform/ui/record";
import { Block, CHECK_ROW, Note, SaveBar, SET_INPUT, SET_SELECT, SField } from "@platform/ui/settings";
import type { AmlPolicyView } from "../lib/contracts";
import { shortDate } from "../lib/format";

/** The pill on every value that is still the code's placeholder (version 0): compliance confirms it by publishing. */
const Confirm = () => <Pill tone="warning">Confirm with compliance</Pill>;

const RULE_WORDS: Record<string, string> = {
  sanctions: "Sanctions list match",
  pep: "Politically exposed person",
  third_party_payer: "Payment from someone who is not a party",
  cash: "Cash above the rulebook's threshold",
  high_risk_country: "Party tied to a listed country",
  missing_source_of_funds: "No source of funds given",
  complex_ownership: "Complex company ownership",
};

/**
 * The compliance rules page (S42, S66): the compliance officer edits and publishes a new version; the MLRO reads. Values
 * that are still the placeholder show "Confirm with compliance". Evidence lists and risk factors are carried over unchanged
 * by the form and kept in each published version.
 */
export function AmlPolicyForm({ p, action }: { p: AmlPolicyView; action: (f: FormData) => void | Promise<void> }) {
  const v = p.values;
  const edit = p.mayPublish;
  const placeholder = p.confirmWithCompliance;
  return (
    <div className="grid gap-6">
      <FactGrid>
        <Fact label="Version in force">
          {p.version === 0 ? "Placeholder (never published)" : `Version ${p.version}`}
        </Fact>
        <Fact label="You can">{edit ? "Edit and publish" : "Read"}</Fact>
      </FactGrid>
      {placeholder && (
        <p className="m-0 text-sm text-muted">
          These are placeholders until compliance publishes its own. <Confirm />
        </p>
      )}
      <form action={action} className="grid gap-6">
        <Block
          title="Warning signs"
          lede="Each sign is on or off, flags the deal or only adds points, and carries points."
        >
          {Object.keys(RULE_WORDS).map((id) => {
            const r = v.rules[id as keyof typeof v.rules];
            return (
              <div key={id} className={CHECK_ROW}>
                <span className="min-w-64 flex-1">
                  {RULE_WORDS[id]} {placeholder && <Confirm />}
                </span>
                <label>
                  <input
                    type="checkbox"
                    name={`on_${id}`}
                    defaultChecked={r.on}
                    disabled={!edit || id === "sanctions"}
                  />
                  On
                </label>
                <select
                  name={`severity_${id}`}
                  defaultValue={r.severity}
                  disabled={!edit || id === "sanctions"}
                  aria-label={`${RULE_WORDS[id]}: effect`}
                  className={SET_SELECT}
                >
                  <option value="flag">Flags the deal</option>
                  <option value="warning">Adds points only</option>
                </select>
                <input
                  name={`points_${id}`}
                  defaultValue={r.points}
                  disabled={!edit}
                  inputMode="numeric"
                  aria-label={`${RULE_WORDS[id]}: points`}
                  className={`${SET_INPUT} w-20`}
                />
                {/* A disabled control isn't sent: the always-on sign is sent by hand. */}
                {id === "sanctions" && (
                  <>
                    <input type="hidden" name="severity_sanctions" value="flag" />
                    <Note>Always on, always flags.</Note>
                  </>
                )}
              </div>
            );
          })}
        </Block>
        <Block title="Countries" lede="Two-letter codes, separated by commas.">
          <SField label={<>Listed countries {placeholder && <Confirm />}</>}>
            <input
              name="highRiskCountries"
              defaultValue={v.highRiskCountries.join(", ")}
              disabled={!edit}
              className={SET_INPUT}
            />
          </SField>
        </Block>
        <Block title="Cut-offs" lede="Points at which a deal moves to the next level.">
          <div className="flex flex-wrap gap-4">
            <SField label={<>Medium from {placeholder && <Confirm />}</>}>
              <input
                name="cutoffMedium"
                defaultValue={v.risk.cutoffs.medium}
                disabled={!edit}
                inputMode="numeric"
                className={`${SET_INPUT} w-24`}
              />
            </SField>
            <SField label={<>High from {placeholder && <Confirm />}</>}>
              <input
                name="cutoffHigh"
                defaultValue={v.risk.cutoffs.high}
                disabled={!edit}
                inputMode="numeric"
                className={`${SET_INPUT} w-24`}
              />
            </SField>
          </div>
        </Block>
        <Block title="When parties are checked again">
          <div className={CHECK_ROW}>
            {(
              [
                ["atOffer", "At the offer"],
                ["beforeAgreementApproval", "Before the agreement is approved"],
                ["beforeTransfer", "Before the transfer"],
                ["onPartyChange", "When a party changes"],
              ] as const
            ).map(([k, w]) => (
              <label key={k}>
                <input type="checkbox" name={k} defaultChecked={v.rescreen[k]} disabled={!edit} />
                {w}
              </label>
            ))}
          </div>
          <SField label="Also every (days)" help="Leave empty for no regular check.">
            <input
              name="everyDays"
              defaultValue={v.rescreen.everyDays ?? ""}
              disabled={!edit}
              inputMode="numeric"
              className={`${SET_INPUT} w-24`}
            />
          </SField>
        </Block>
        {edit ? (
          <SaveBar note="Publishing makes the next version. Deals keep the version they started under.">
            <Button type="submit" variant="primary" size="sm">
              Publish as a new version
            </Button>
          </SaveBar>
        ) : (
          <Note>The compliance officer publishes changes. You can read every value.</Note>
        )}
      </form>
      <Section id="history" title="Published versions" hint="Read-only">
        {p.history.length === 0 ? (
          <p className="m-0 text-sm text-muted">None yet.</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0 text-sm">
            {p.history.map((h) => (
              <li key={h.version}>
                Version {h.version}, published {shortDate(h.createdAt)}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
