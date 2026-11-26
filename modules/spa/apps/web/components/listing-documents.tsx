"use client";

import { Button } from "@platform/ui/button";
import { FIELD, HINT, INPUT, LABEL } from "@platform/ui/form";
import { Pill } from "@platform/ui/pill";
import { Fact, FactGrid, ROW_CARD, Section, Sub } from "@platform/ui/record";
import { useRef, useState, useTransition } from "react";
import {
  type ListingStepResult,
  recordOwnershipAction,
  recordSignatureAction,
} from "../app/(staff)/listings/[id]/actions";
import type { ListingRecord } from "../lib/contracts";
import { shortDate } from "../lib/format";
import { OWNERSHIP_LABEL } from "../lib/words";

type DocKind = "title_deed" | "oqood" | "listing_agreement" | "permit";

/** A file picker and an Upload button for one kind of document. The file goes through the staff route, never straight to the engine. */
function UploadFile({ listingId, kind, label }: { listingId: string; kind: () => DocKind; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  function send() {
    const file = input.current?.files?.[0];
    if (!file) return setMessage({ ok: false, text: "Choose a file first." });
    start(async () => {
      const form = new FormData();
      form.set("kind", kind());
      form.set("file", file);
      const res = await fetch(`/listings/${listingId}/documents`, { method: "POST", body: form }).catch(() => null);
      const body = (await res?.json().catch(() => ({}))) as { error?: string; duplicate?: boolean } | undefined;
      if (res?.ok) {
        setMessage({ ok: true, text: body?.duplicate ? "That file was already added." : "Added." });
        if (input.current) input.current.value = "";
        window.location.reload();
      } else setMessage({ ok: false, text: body?.error ?? "The file wasn't saved. Try again." });
    });
  }
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-0">
          <span className="sr-only">{label}</span>
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="max-w-[16rem] text-sm text-ink file:mr-2 file:cursor-pointer file:rounded-full file:border file:border-line file:bg-page file:px-3 file:py-1.5 file:font-sans file:text-sm file:font-semibold"
          />
        </label>
        <Button variant="ghost" size="sm" disabled={busy} onClick={send}>
          {busy ? "Uploading…" : "Upload"}
        </Button>
      </div>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`m-0 text-xs ${message.ok ? "text-muted" : "text-danger"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

function Files({ listing, kinds }: { listing: ListingRecord; kinds: DocKind[] }) {
  const docs = (listing.documents ?? []).filter((d) => kinds.includes(d.kind));
  if (!docs.length) return <p className="m-0 text-sm text-muted">No file added yet.</p>;
  return (
    <ul className="m-0 grid list-none gap-1.5 p-0">
      {docs.map((d) => (
        <li key={d.id} className={`${ROW_CARD} flex flex-wrap items-center justify-between gap-2 text-sm`}>
          <a
            href={`/listings/${listing.id}/documents/${d.id}`}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-ink! underline"
          >
            {d.fileName}
          </a>
          <span className="text-xs text-muted">
            {d.kindLabel} · {shortDate(d.uploadedAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The owners on the ownership document, typed by staff, matched to the sellers by code in the engine. */
function OwnershipForm({ listing: l }: { listing: ListingRecord }) {
  const [kind, setKind] = useState<"title_deed" | "oqood">(l.ownership?.kind ?? "title_deed");
  const [ref, setRef] = useState(l.ownership?.ref ?? "");
  const [owners, setOwners] = useState((l.ownership?.owners ?? []).join("\n"));
  const [result, setResult] = useState<ListingStepResult>({});
  const [busy, start] = useTransition();
  const list = owners
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);
  return (
    <form
      noValidate
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ref.trim() || !list.length)
          return setResult({ error: "Enter the document number and at least one owner." });
        start(async () => {
          const r = await recordOwnershipAction(l.id, kind, ref.trim(), list);
          setResult(r);
          if (r.ok) window.location.reload();
        });
      }}
    >
      <div className="grid gap-3 @[560px]:grid-cols-[12rem_1fr]">
        <label className={FIELD}>
          <span className={LABEL}>Document</span>
          <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="title_deed">Title deed</option>
            <option value="oqood">Oqood certificate</option>
          </select>
        </label>
        <label className={FIELD}>
          <span className={LABEL}>Document number</span>
          <input className={INPUT} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} />
        </label>
      </div>
      <label className={FIELD}>
        <span className={LABEL}>Owners as written on the document</span>
        <textarea className={INPUT} rows={3} value={owners} onChange={(e) => setOwners(e.target.value)} />
        <span className={HINT}>One name on each line. They are matched to the sellers by code.</span>
      </label>
      {result.error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {result.error}
        </p>
      )}
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? "Saving…" : l.ownership ? "Save the owners again" : "Save the owners"}
        </Button>
      </div>
    </form>
  );
}

function SignButton({ listingId, partyId }: { listingId: string; partyId: string }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | undefined>();
  return (
    <span className="grid justify-items-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await recordSignatureAction(listingId, partyId);
            setError(r.error);
            if (r.ok) window.location.reload();
          })
        }
      >
        {busy ? "Saving…" : "Record signature"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * The Documents card of a listing record (S77): Ownership, Listing agreement and Permit, each its own sub-card. Files go
 * through the staff upload route; the owners and the signatures are recorded by staff and checked by the engine. A role
 * that only reads sees none of it: the engine sends it no documents and no sellers.
 */
export function ListingDocuments({ listing: l, canWrite }: { listing: ListingRecord; canWrite: boolean }) {
  const open = l.state !== "SOLD" && l.state !== "WITHDRAWN";
  const early = l.state === "DRAFT" || l.state === "VERIFIED";
  const [ownKind, setOwnKind] = useState<"title_deed" | "oqood">(l.ownership?.kind ?? "title_deed");
  if (l.documents === null) return null;
  const waiting = l.ownership && !l.ownership.matched && l.ownership.waitingForManager;
  return (
    <Section id="documents" title="Documents" hint="The files and checks that let a listing go live">
      <div className="grid gap-3">
        <Section id="ownership" title="Ownership">
          {l.ownership ? (
            <FactGrid>
              <Fact label="Document">{OWNERSHIP_LABEL[l.ownership.kind]}</Fact>
              <Fact label="Number" mono>
                {l.ownership.ref ?? "Not set"}
              </Fact>
              <Fact label="Result">
                {l.ownership.matched ? (
                  <Pill tone="success">Matched to the sellers</Pill>
                ) : waiting ? (
                  <Pill tone="waiting">Waiting for the sales manager</Pill>
                ) : (
                  <Pill tone="neutral">Not matched to the sellers yet</Pill>
                )}
              </Fact>
            </FactGrid>
          ) : (
            <p className="m-0 text-sm text-muted">No ownership document recorded yet.</p>
          )}
          {(l.ownership?.owners?.length ?? 0) > 0 && (
            <div className="grid gap-1">
              <span className="text-xs font-semibold text-muted">Owners on the document</span>
              <ul className="m-0 list-none p-0 text-sm">
                {l.ownership!.owners!.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
          )}
          <Files listing={l} kinds={["title_deed", "oqood"]} />
          {canWrite && open && (
            <div className="grid gap-4 border-t border-line pt-3">
              <div className="grid gap-1.5">
                <span className="text-xs font-semibold text-muted">Add the file</span>
                <div className="flex flex-wrap items-center gap-2">
                  <label>
                    <span className="sr-only">File is a</span>
                    <select
                      className={`${INPUT} w-auto`}
                      value={ownKind}
                      onChange={(e) => setOwnKind(e.target.value as typeof ownKind)}
                    >
                      <option value="title_deed">Title deed</option>
                      <option value="oqood">Oqood certificate</option>
                    </select>
                  </label>
                  <UploadFile listingId={l.id} kind={() => ownKind} label="Ownership document file" />
                </div>
              </div>
              {l.state === "DRAFT" && <OwnershipForm listing={l} />}
            </div>
          )}
        </Section>

        <Section id="listing-agreement" title="Listing agreement" hint="Every co-owner signs">
          {l.sellers ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {l.sellers.map((s) => (
                <li
                  key={s.partyId || s.name}
                  className={`${ROW_CARD} flex flex-wrap items-center justify-between gap-2 text-sm`}
                >
                  <span>
                    <b className="font-semibold">{s.name}</b>
                    <Sub>{s.kind === "company" ? "Company, signs through its signatory" : "Individual"}</Sub>
                  </span>
                  {s.signed ? (
                    <Pill tone="success">Signed</Pill>
                  ) : canWrite && early && s.partyId ? (
                    <SignButton listingId={l.id} partyId={s.partyId} />
                  ) : (
                    <Pill tone="neutral">Not signed yet</Pill>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <Files listing={l} kinds={["listing_agreement"]} />
          {canWrite && open && (
            <div className="border-t border-line pt-3">
              <UploadFile listingId={l.id} kind={() => "listing_agreement"} label="Signed listing agreement file" />
            </div>
          )}
        </Section>

        <Section id="permit" title="Permit" hint="Dates are changed with Edit listing">
          <FactGrid>
            <Fact label="Permit number" mono>
              {l.permit.no ?? "None"}
            </Fact>
            <Fact label="Issued">{l.permit.issuedOn ? shortDate(l.permit.issuedOn) : "Not set"}</Fact>
            <Fact label="Last valid day">{l.permit.expiresOn ? shortDate(l.permit.expiresOn) : "No permit"}</Fact>
          </FactGrid>
          <Files listing={l} kinds={["permit"]} />
          {canWrite && open && (
            <div className="border-t border-line pt-3">
              <UploadFile listingId={l.id} kind={() => "permit"} label="Permit file" />
            </div>
          )}
        </Section>
      </div>
    </Section>
  );
}
