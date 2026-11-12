"use client";

import { type Emirate, EMIRATE_LABELS, EMIRATES } from "@leasing/core";
import { PlusIcon as IconPlus } from "@phosphor-icons/react";
import { useState } from "react";
import { Banner } from "../../../../components/ui/form";
import { Button } from "../../../../components/ui/button";
import { SET_SELECT, SField } from "../../../../components/ui/settings";
import { Sheet } from "../../../../components/ui/sheet";
import { createDraftAction } from "./actions";

/** "New draft": pick the emirate, then the published version whose values the draft starts from. */
export function NewDraft({
  activeByEmirate,
  published,
}: {
  activeByEmirate: Record<Emirate, string | null>;
  published: { version: string; emirate: Emirate }[];
}) {
  const [open, setOpen] = useState(false);
  const [emirate, setEmirate] = useState<Emirate>("dubai");
  // Its own active version first; an emirate with no rules yet starts from another emirate's version.
  const own = published.filter((p) => p.emirate === emirate);
  const sources = [...own, ...published.filter((p) => p.emirate !== emirate)];
  const [basedOn, setBasedOn] = useState(activeByEmirate.dubai ?? published[0]?.version ?? "");
  const pick = (e: Emirate) => {
    setEmirate(e);
    setBasedOn(activeByEmirate[e] ?? activeByEmirate.dubai ?? published[0]?.version ?? "");
  };
  const crossEmirate = sources.find((s) => s.version === basedOn)?.emirate !== emirate;
  return (
    <>
      <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
        <IconPlus size={16} />
        New draft
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="New rulebook draft">
        <form action={createDraftAction} className="grid gap-4">
          <SField label="Emirate" help="The rules apply to units in this emirate.">
            <select
              name="emirate"
              value={emirate}
              onChange={(e) => pick(e.target.value as Emirate)}
              className={SET_SELECT}
            >
              {EMIRATES.map((e) => (
                <option key={e} value={e}>
                  {EMIRATE_LABELS[e]}
                  {activeByEmirate[e] ? "" : " (no rules yet)"}
                </option>
              ))}
            </select>
          </SField>
          <SField label="Copy values from" help="A published version. You edit the copy before publishing.">
            <select name="basedOn" value={basedOn} onChange={(e) => setBasedOn(e.target.value)} className={SET_SELECT}>
              {sources.map((s) => (
                <option key={s.version} value={s.version}>
                  {s.version}
                  {s.version === activeByEmirate[s.emirate] ? " (active)" : ""}
                </option>
              ))}
            </select>
          </SField>
          {crossEmirate && (
            <Banner tone="warn">
              <span>
                {activeByEmirate[emirate]
                  ? `These values come from another emirate. Check every value against ${EMIRATE_LABELS[emirate]} law.`
                  : `${EMIRATE_LABELS[emirate]} has no rules yet, so offers and leases there are refused until one is published. Check every value against ${EMIRATE_LABELS[emirate]} law; publishing needs a confirmed legal review.`}
              </span>
            </Banner>
          )}
          <div>
            <Button type="submit" variant="primary" size="sm" disabled={!basedOn}>
              Create draft
            </Button>
          </div>
        </form>
      </Sheet>
    </>
  );
}
