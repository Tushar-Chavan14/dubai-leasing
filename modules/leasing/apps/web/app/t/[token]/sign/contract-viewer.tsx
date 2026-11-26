"use client";

import { FilePdfIcon as IconPdf, XIcon as IconClose } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Modal } from "@platform/ui/modal";
import { MarkLayer, type Marking } from "./mark-layer";

/** One page image. A failed load (e.g. 429 from the rate limit) is retried once after a pause, then offers a button. */
function PageImage({ token, n, pages }: { token: string; n: number; pages: number }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onError = () => {
    if (!retried.current) {
      retried.current = true;
      timer.current = setTimeout(() => setAttempt((a) => a + 1), 5000);
    } else setFailed(true);
  };
  if (failed)
    return (
      <div
        data-page={n}
        className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md bg-white p-4 text-sm"
      >
        <p className="m-0">Too many requests, try again in a minute.</p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setAttempt((a) => a + 1);
          }}
          className="min-h-10 cursor-pointer rounded-lg border border-line bg-transparent px-3 text-sm text-ink"
        >
          Try again
        </button>
      </div>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={attempt}
      src={`/t/${encodeURIComponent(token)}/contract/pages/${n}${attempt ? `?r=${attempt}` : ""}`}
      alt={`Contract page ${n} of ${pages}`}
      draggable={false}
      loading="lazy"
      onError={onError}
      onContextMenu={(e) => e.preventDefault()}
      data-page={n}
      className="block h-auto w-full select-none rounded-md bg-white shadow-sm"
    />
  );
}

/** Opens the contract read-only, as page images rendered by the server (the browser never gets the PDF). */
export function ContractViewer({
  token,
  marking,
  side,
}: {
  token: string;
  /** When given, the words on each page can be selected and marked. */
  marking?: Marking;
  /** Shown beside the pages on wide screens and under them on phones (the list of marks). */
  side?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(1);
  const list = useRef<HTMLDivElement>(null);

  // The page counter follows the page nearest the top of the scroll area.
  useEffect(() => {
    const box = list.current;
    if (!box || !pages) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setCurrent(Number((e.target as HTMLElement).dataset.page));
      },
      { root: box, rootMargin: "0px 0px -60% 0px" },
    );
    box.querySelectorAll("img").forEach((img) => io.observe(img));
    return () => io.disconnect();
  }, [pages]);

  useEffect(() => {
    if (!open || pages !== null) return;
    let live = true;
    fetch(`/t/${encodeURIComponent(token)}/contract/pages`, { cache: "no-store" })
      .then((r) => {
        if (r.status === 429) {
          if (live) setBusy(true);
          return Promise.reject(new Error("busy"));
        }
        return r.ok ? (r.json() as Promise<{ pages: number }>) : Promise.reject(new Error("gone"));
      })
      .then((d) => live && setPages(d.pages))
      .catch((e: Error) => live && e.message !== "busy" && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, pages, token]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-transparent px-3.5 py-3 text-left font-sans text-[15px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <IconPdf size={22} aria-hidden />
        Read the full contract
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Tenancy contract" wide>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <p className="m-0 text-sm font-semibold" aria-live="polite">
            Tenancy contract{pages ? ` · page ${current} of ${pages}` : ""}
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-transparent px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <IconClose size={16} aria-hidden />
            Close
          </button>
        </div>
        <div ref={list} className="overflow-y-auto bg-line/40 p-3 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <div className="grid gap-4">
              {failed && <p className="m-0 text-sm">This link has expired.</p>}
              {busy && <p className="m-0 text-sm">Too many requests, try again in a minute.</p>}
              {pages === null && !failed && !busy && <p className="m-0 text-sm text-muted">Loading the contract...</p>}
              {pages !== null &&
                Array.from({ length: pages }, (_, i) => i + 1).map((n) =>
                  marking ? (
                    <div key={n} className="relative">
                      <PageImage token={token} n={n} pages={pages} />
                      <MarkLayer token={token} n={n} marking={marking} />
                    </div>
                  ) : (
                    <PageImage key={n} token={token} n={n} pages={pages} />
                  ),
                )}
            </div>
            {side && <div className="lg:sticky lg:top-0">{side}</div>}
          </div>
        </div>
      </Modal>
    </>
  );
}
