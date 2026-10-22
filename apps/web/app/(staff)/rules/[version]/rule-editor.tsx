"use client";

import { useState, useTransition } from "react";
import { IconCheck, IconPlus, IconTrash, IconWarning } from "../../../../lib/icons";
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

  return (
    <div className="split">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const referenceRules = notes.map(({ k: _k, ...n }) => n);
          run("save", () => saveDraftAction(detail.version, { values, referenceRules, effectiveFrom }));
        }}
      >
        <section className="panel panel-pad" aria-labelledby="ed-values-h">
          <h2 id="ed-values-h" className="section-title">
            Notices and deadlines
          </h2>
          <div className="grid-fields">
            {NUMBER_FIELDS.map((f) => (
              <label key={f.path} className="field span-3">
                <span className="field-label">
                  {f.label} <em>({f.unit})</em>
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={0}
                  required
                  value={readPath(values, f.path)}
                  onChange={(e) => setValues((v) => writePath(v, f.path, e.target.valueAsNumber))}
                />
                <span className="hint">{f.hint}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="panel" aria-labelledby="ed-bands-h">
          <div className="panel-head">
            <h2 id="ed-bands-h">Rent-cap bands</h2>
            <span className="hint">in ascending order of gap; the first matching band applies</span>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Band</th>
                  <th>Gap below SRI up to (%)</th>
                  <th>Max increase (%)</th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {values.rentCapBands.map((b, i) => (
                  <tr key={i}>
                    <td className="muted">{bandRows(values)[i]?.gap}</td>
                    <td>
                      <span className="field">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          required
                          aria-label={`Band ${i + 1} gap up to`}
                          value={b.gapUpTo}
                          onChange={(e) => setBand(i, "gapUpTo", e.target.valueAsNumber)}
                        />
                      </span>
                    </td>
                    <td>
                      <span className="field">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          required
                          aria-label={`Band ${i + 1} max increase`}
                          value={b.maxIncrease}
                          onChange={(e) => setBand(i, "maxIncrease", e.target.valueAsNumber)}
                        />
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn ghost icon"
                        aria-label={`Remove band ${i + 1}`}
                        disabled={values.rentCapBands.length <= 1}
                        onClick={() =>
                          setValues((v) => ({ ...v, rentCapBands: v.rentCapBands.filter((_, j) => j !== i) }))
                        }
                      >
                        <IconTrash size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="muted">{bandRows(values).at(-1)?.gap}</td>
                  <td colSpan={3} className="muted">
                    Uses “Increase above the last band”: {values.aboveLastBandMaxIncrease}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="panel-pad" style={{ paddingTop: 12 }}>
            <button
              type="button"
              className="btn small"
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
            </button>
          </div>
        </section>

        <section className="panel panel-pad" aria-labelledby="ed-notes-h">
          <h2 id="ed-notes-h" className="section-title">
            Reference notes
          </h2>
          <p className="muted" style={{ fontSize: 13.5, marginBottom: 12 }}>
            Company guidance shown to staff and the copilot. Not law: the engine doesn&apos;t enforce them, and they
            can&apos;t change any value above.
          </p>
          <div className="stack">
            {notes.map((n, i) => (
              <div key={n.k} className="inline-form stack" style={{ gap: 10 }}>
                <label className="field">
                  <span className="field-label">Title</span>
                  <input
                    required
                    maxLength={120}
                    value={n.title}
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
                </label>
                <label className="field">
                  <span className="field-label">Text</span>
                  <textarea
                    required
                    maxLength={2000}
                    rows={3}
                    value={n.text}
                    onChange={(e) => setNote(i, { text: e.target.value })}
                  />
                </label>
                <div className="btn-row">
                  <span className="muted ref" style={{ fontSize: 12.5 }}>
                    id {n.id}
                  </span>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => setNotes((ns) => ns.filter((_, j) => j !== i))}
                  >
                    <IconTrash size={14} />
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <div>
              <button type="button" className="btn small" disabled={notes.length >= 50} onClick={addNote}>
                <IconPlus size={14} />
                Add note
              </button>
            </div>
          </div>
        </section>

        <section className="panel panel-pad" aria-labelledby="ed-sources-h">
          <h2 id="ed-sources-h" className="section-title">
            Sources
          </h2>
          <div className="stack" style={{ gap: 10 }}>
            {values.sources.map((s, i) => (
              <div key={i} className="btn-row" style={{ flexWrap: "nowrap" }}>
                <label className="field" style={{ flex: 1 }}>
                  <span className="sr-only">Source {i + 1}</span>
                  <input
                    required
                    maxLength={300}
                    value={s}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, sources: v.sources.map((x, j) => (j === i ? e.target.value : x)) }))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn ghost icon"
                  aria-label={`Remove source ${i + 1}`}
                  onClick={() => setValues((v) => ({ ...v, sources: v.sources.filter((_, j) => j !== i) }))}
                >
                  <IconTrash size={16} />
                </button>
              </div>
            ))}
            <div>
              <button
                type="button"
                className="btn small"
                disabled={values.sources.length >= 20}
                onClick={() => setValues((v) => ({ ...v, sources: [...v.sources, ""] }))}
              >
                <IconPlus size={14} />
                Add source
              </button>
            </div>
          </div>
        </section>

        <section className="panel panel-pad" aria-labelledby="ed-eff-h">
          <h2 id="ed-eff-h" className="section-title">
            Effective from
          </h2>
          <label className="field" style={{ maxWidth: 240 }}>
            <span className="field-label">Date (Dubai)</span>
            <input
              type="date"
              required
              min={detail.today}
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
            <span className="hint">Today or later. New leases get this version from that date.</span>
          </label>
        </section>

        <div className="btn-row">
          <button type="submit" className="btn primary" disabled={pending || !dirty}>
            Save draft
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={pending}
            onClick={() => {
              if (confirm(`Delete draft ${detail.version}? This can't be undone.`))
                run("save", () => deleteDraftAction(detail.version));
            }}
          >
            <IconTrash size={14} />
            Delete draft
          </button>
          {dirty && <span className="muted">Unsaved changes</span>}
        </div>
        {state.from === "save" && <Feedback state={state} />}
      </form>

      <aside className="stack sticky">
        <ChangesList
          title={detail.active ? `Changes vs active (${detail.active})` : "Changes"}
          changes={detail.changesVsActive}
        />
        <section className="panel panel-pad" aria-labelledby="pub-h">
          <h2 id="pub-h" className="section-title">
            Publish
          </h2>
          <div className="stack" style={{ gap: 12 }}>
            {needsReview && (
              <div className="alert" data-tone="warn">
                <IconWarning size={16} />
                <span>
                  These changes weaken tenant protection compared with the base version {detail.baseVersion}:{" "}
                  {detail.loosened.map((l) => `${fieldLabel(l.field)} ${show(l.base)} → ${show(l.value)}`).join("; ")}.
                </span>
              </div>
            )}
            {needsReview && (
              <label className="check">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>I confirm a Dubai property lawyer reviewed these changes.</span>
              </label>
            )}
            <p className="muted" style={{ fontSize: 13.5 }}>
              Once published, this version can&apos;t be edited or deleted. Existing leases keep their own version.
            </p>
            <div>
              <button
                type="button"
                className="btn primary"
                disabled={pending || dirty || (needsReview && !confirmed)}
                onClick={() => run("publish", () => publishAction(detail.version, confirmed))}
              >
                Publish {detail.version}
              </button>
              {dirty && (
                <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                  Save the draft first; the comparison and checks use the saved version.
                </p>
              )}
            </div>
            {state.from === "publish" && <Feedback state={state} />}
          </div>
        </section>
        <History events={detail.events} />
      </aside>
    </div>
  );
}

function Feedback({ state }: { state: RuleActionState }) {
  if (state.ok)
    return (
      <div className="alert" data-tone="good" role="status">
        <IconCheck size={16} />
        {state.ok}
      </div>
    );
  if (!state.error) return null;
  return (
    <div className="alert" data-tone="bad" role="alert">
      <IconWarning size={16} />
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
    </div>
  );
}
