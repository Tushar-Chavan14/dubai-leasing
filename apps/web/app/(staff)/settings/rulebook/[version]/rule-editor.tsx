"use client";

import { EMIRATE_LABELS } from "@leasing/core";
import { useState, useTransition } from "react";
import {
  CheckIcon as IconCheck,
  PlusIcon as IconPlus,
  TrashIcon as IconTrash,
  WarningIcon as IconWarning,
} from "@phosphor-icons/react";
import { Button } from "../../../../../components/ui/button";
import { Banner, INPUT } from "../../../../../components/ui/form";
import {
  FormGrid,
  Panel,
  SaveBar,
  SET_INPUT,
  SField,
  SPAN,
  GRID6,
  TABLE,
  TD,
  TH,
  Block,
} from "../../../../../components/ui/settings";
import { deleteDraftAction, publishAction, type RuleActionState, saveDraftAction } from "../actions";
import {
  bandRows,
  fieldLabel,
  NUMBER_FIELDS,
  readPath,
  type ReferenceRule,
  type RulebookDetail,
  type RuleValues,
  show,
  writePath,
} from "../labels";
import { ChangesList, History } from "../parts";

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

/** "values.renewalSendAtDays: the company send day …" → "Company send day (days): The company send day …". */
const reasonText = (r: string) => {
  const m = /^([\w.-]+): (.+)$/.exec(r);
  return m ? `${fieldLabel(m[1]!)}: ${m[2]}` : r;
};

export function RuleEditor({ detail }: { detail: RulebookDetail }) {
  // Remount after each save (the page passes fresh props), so local state starts from the saved draft.
  return <Editor key={detail.updatedAt} detail={detail} />;
}

function Editor({ detail }: { detail: RulebookDetail }) {
  const [values, setValues] = useState<RuleValues>(detail.values);
  // `k` is a stable React key: a new note's id follows its title while typing.
  const [notes, setNotes] = useState<(ReferenceRule & { k: number })[]>(
    detail.referenceRules.map((n, k) => ({ ...n, k })),
  );
  const [effectiveFrom, setEffectiveFrom] = useState(detail.effectiveFrom);
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<RuleActionState & { from?: "save" | "publish" }>({});
  const [pending, start] = useTransition();

  const dirty =
    JSON.stringify({ values, notes: notes.map(({ k: _k, ...n }) => n), effectiveFrom }) !==
    JSON.stringify({ values: detail.values, notes: detail.referenceRules, effectiveFrom: detail.effectiveFrom });
  const needsReview = detail.loosened.length > 0;

  const run = (from: "save" | "publish", fn: () => Promise<RuleActionState>) =>
    start(async () => setState({ ...(await fn()), from }));
  const setBand = (i: number, key: "gapUpTo" | "maxIncrease", n: number) =>
    setValues((v) => ({ ...v, rentCapBands: v.rentCapBands.map((b, j) => (j === i ? { ...b, [key]: n } : b)) }));
  const setNote = (i: number, patch: Partial<ReferenceRule>) =>
    setNotes((ns) => ns.map((n, j) => (j === i ? { ...n, ...patch } : n)));
  const addNote = () =>
    setNotes((ns) => {
      let id = `note-${ns.length + 1}`;
      for (let k = ns.length + 2; ns.some((n) => n.id === id); k++) id = `note-${k}`;
      return [...ns, { id, title: "", text: "", k: Math.max(-1, ...ns.map((n) => n.k)) + 1 }];
    });

  const cell = `${SET_INPUT} w-24`;
  return (
    <FormGrid
      preview={
        <aside className="grid gap-5 self-start @3xl:sticky @3xl:top-4">
          <ChangesList
            title={detail.active ? `Changes vs active (${detail.active})` : "Changes"}
            changes={detail.changesVsActive}
          />
          <Panel className="grid gap-3 p-5">
            <h2 id="pub-h" className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">
              Publish
            </h2>
            {needsReview && (
              <Banner tone="warn">
                <IconWarning size={16} className="mt-0.5 shrink-0" />
                <span>
                  {detail.baseVersion
                    ? `These changes weaken tenant protection compared with the base version ${detail.baseVersion}: `
                    : "This emirate has no reviewed rules yet, so publishing needs a confirmed legal review: "}
                  {detail.loosened
                    .map((l) =>
                      l.base === null && l.value === null
                        ? l.field
                        : `${fieldLabel(l.field)} ${show(l.base)} → ${show(l.value)}`,
                    )
                    .join("; ")}
                  .
                </span>
              </Banner>
            )}
            {needsReview && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>I confirm a Dubai property lawyer reviewed these changes.</span>
              </label>
            )}
            <p className="m-0 text-[13px] text-muted">
              Once published, this version can&apos;t be edited or deleted. Existing leases keep their own version.
            </p>
            <div>
              <Button
                variant="primary"
                size="sm"
                disabled={pending || dirty || (needsReview && !confirmed)}
                onClick={() => run("publish", () => publishAction(detail.version, confirmed))}
              >
                Publish {detail.version}
              </Button>
              {dirty && (
                <p className="m-0 mt-2 text-[13px] text-muted">
                  Save the draft first; the comparison and checks use the saved version.
                </p>
              )}
            </div>
            {state.from === "publish" && <Feedback state={state} />}
          </Panel>
          <History events={detail.events} />
        </aside>
      }
    >
      <form
        className="grid gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          const referenceRules = notes.map(({ k: _k, ...n }) => n);
          run("save", () => saveDraftAction(detail.version, { values, referenceRules, effectiveFrom }));
        }}
      >
        <Panel className="grid gap-4 p-5">
          <Block
            id="ed-values-h"
            title="Notices and deadlines"
            lede="Days and limits the engine uses for every notice. Each lease keeps the version it was created under."
          >
            <div className={GRID6}>
              {NUMBER_FIELDS.map((f) => (
                <SField key={f.path} label={`${f.label} (${f.unit})`} help={f.hint} className={SPAN[3]}>
                  <input
                    type="number"
                    inputMode="numeric"
                    step={1}
                    min={0}
                    required
                    value={readPath(values, f.path)}
                    onChange={(e) => setValues((v) => writePath(v, f.path, e.target.valueAsNumber))}
                    className={SET_INPUT}
                  />
                </SField>
              ))}
            </div>
          </Block>
        </Panel>

        <Panel className="overflow-x-auto">
          <div className="flex flex-wrap items-baseline gap-x-3 px-5 pt-5">
            <h2 id="ed-bands-h" className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">
              Rent-cap bands
            </h2>
            <span className="text-xs text-muted">in ascending order of gap; the first matching band applies</span>
          </div>
          <table className={`${TABLE} mt-3`}>
            <thead>
              <tr>
                <th className={TH}>Band</th>
                <th className={TH}>Gap below SRI up to (%)</th>
                <th className={TH}>Max increase (%)</th>
                <th className={TH} aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {values.rentCapBands.map((b, i) => (
                <tr key={i} className="group">
                  <td className={`${TD} text-muted`}>{bandRows(values)[i]?.gap}</td>
                  <td className={TD}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      required
                      aria-label={`Band ${i + 1} gap up to`}
                      value={b.gapUpTo}
                      onChange={(e) => setBand(i, "gapUpTo", e.target.valueAsNumber)}
                      className={cell}
                    />
                  </td>
                  <td className={TD}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      required
                      aria-label={`Band ${i + 1} max increase`}
                      value={b.maxIncrease}
                      onChange={(e) => setBand(i, "maxIncrease", e.target.valueAsNumber)}
                      className={cell}
                    />
                  </td>
                  <td className={TD}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="!px-2.5"
                      aria-label={`Remove band ${i + 1}`}
                      disabled={values.rentCapBands.length <= 1}
                      onClick={() =>
                        setValues((v) => ({ ...v, rentCapBands: v.rentCapBands.filter((_, j) => j !== i) }))
                      }
                    >
                      <IconTrash size={16} />
                    </Button>
                  </td>
                </tr>
              ))}
              <tr className="group">
                <td className={`${TD} text-muted`}>{bandRows(values).at(-1)?.gap}</td>
                <td colSpan={3} className={`${TD} text-muted`}>
                  Uses “Increase above the last band”: {values.aboveLastBandMaxIncrease}%
                </td>
              </tr>
            </tbody>
          </table>
          <div className="px-5 pb-5 pt-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={values.rentCapBands.length >= 10}
              onClick={() =>
                setValues((v) => {
                  const last = v.rentCapBands.at(-1);
                  const gap = Math.min(100, (last?.gapUpTo ?? 0) + 10);
                  return {
                    ...v,
                    rentCapBands: [...v.rentCapBands, { gapUpTo: gap, maxIncrease: last?.maxIncrease ?? 0 }],
                  };
                })
              }
            >
              <IconPlus size={14} />
              Add band
            </Button>
          </div>
        </Panel>

        <Panel className="grid gap-4 p-5">
          <Block
            id="ed-notes-h"
            title="Reference notes"
            lede="Company guidance shown to staff and the copilot. Not law: the engine doesn't enforce them, and they can't change any value above."
          >
            <div className="grid gap-4">
              {notes.map((n, i) => (
                <div key={n.k} className="grid gap-2.5 rounded-xl border border-line bg-raised p-4">
                  <SField label="Title">
                    <input
                      required
                      maxLength={120}
                      value={n.title}
                      className={SET_INPUT}
                      onChange={(e) =>
                        setNote(i, {
                          title: e.target.value,
                          // New notes take their id from the title until saved.
                          ...(detail.referenceRules.some((r) => r.id === n.id)
                            ? {}
                            : { id: slug(e.target.value) || `note-${i + 1}` }),
                        })
                      }
                    />
                  </SField>
                  <SField label="Text">
                    <textarea
                      required
                      maxLength={2000}
                      rows={3}
                      value={n.text}
                      className={`${INPUT} resize-y`}
                      onChange={(e) => setNote(i, { text: e.target.value })}
                    />
                  </SField>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted">id {n.id}</span>
                    <Button variant="ghost" size="sm" onClick={() => setNotes((ns) => ns.filter((_, j) => j !== i))}>
                      <IconTrash size={14} />
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              <div>
                <Button variant="ghost" size="sm" disabled={notes.length >= 50} onClick={addNote}>
                  <IconPlus size={14} />
                  Add note
                </Button>
              </div>
            </div>
          </Block>
        </Panel>

        <Panel className="grid gap-4 p-5">
          <Block id="ed-sources-h" title="Sources" lede="Where each rule comes from, so staff can check it.">
            <div className="grid gap-2.5">
              {values.sources.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Source {i + 1}</span>
                    <input
                      required
                      maxLength={300}
                      value={s}
                      className={SET_INPUT}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, sources: v.sources.map((x, j) => (j === i ? e.target.value : x)) }))
                      }
                    />
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="!px-2.5"
                    aria-label={`Remove source ${i + 1}`}
                    onClick={() => setValues((v) => ({ ...v, sources: v.sources.filter((_, j) => j !== i) }))}
                  >
                    <IconTrash size={16} />
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={values.sources.length >= 20}
                  onClick={() => setValues((v) => ({ ...v, sources: [...v.sources, ""] }))}
                >
                  <IconPlus size={14} />
                  Add source
                </Button>
              </div>
            </div>
          </Block>
        </Panel>

        <Panel className="grid gap-4 p-5">
          <Block id="ed-eff-h" title="Emirate and effective date">
            <SField label="Emirate" help="Set when the draft was created. Start a new draft for another emirate.">
              <input
                value={EMIRATE_LABELS[detail.emirate]}
                readOnly
                disabled
                className={`${SET_INPUT} max-w-[260px]`}
              />
            </SField>
            <SField
              label="Date (Dubai)"
              help="Today or later. New leases get this version from that date."
              className="max-w-[260px]"
            >
              <input
                type="date"
                required
                min={detail.today}
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className={SET_INPUT}
              />
            </SField>
          </Block>
        </Panel>

        {state.from === "save" && <Feedback state={state} />}
        <SaveBar note={dirty ? "Unsaved changes" : "All changes saved"}>
          <Button
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (confirm(`Delete draft ${detail.version}? This can't be undone.`))
                run("save", () => deleteDraftAction(detail.version));
            }}
          >
            <IconTrash size={14} />
            Delete draft
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={pending || !dirty}>
            Save draft
          </Button>
        </SaveBar>
      </form>
    </FormGrid>
  );
}

function Feedback({ state }: { state: RuleActionState }) {
  if (state.ok)
    return (
      <Banner tone="good" role="status">
        <IconCheck size={16} className="mt-0.5 shrink-0" />
        {state.ok}
      </Banner>
    );
  if (!state.error) return null;
  return (
    <Banner tone="bad" role="alert">
      <IconWarning size={16} className="mt-0.5 shrink-0" />
      <span>
        {state.error}
        {state.reasons && state.reasons.length > 0 && (
          <ul>
            {state.reasons.map((r) => (
              <li key={r}>{reasonText(r)}</li>
            ))}
          </ul>
        )}
      </span>
    </Banner>
  );
}
