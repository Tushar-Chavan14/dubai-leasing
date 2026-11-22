import { buttonClass } from "@platform/ui/button";
import { Banner, FIELD, INPUT, LABEL } from "@platform/ui/form";
import type { Metadata } from "next";
import { PartyChat } from "../../../../../components/party-chat";
import { linkProblem, uploadError } from "../../../../../lib/buyer-link";
import { publicEngine } from "../../../../../lib/engine";
import { sendDocuments } from "./actions";

export const metadata: Metadata = { title: "Upload your documents", robots: { index: false } };

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Asia/Dubai",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** A party's upload page (design.md §7.3): what we need in plain words, one upload per document, then Send my documents. */
export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; uploaded?: string; sent?: string }>;
}) {
  const { token } = await params;
  const { error, uploaded, sent } = await searchParams;
  if (sent)
    return (
      <section className="grid gap-2" aria-live="polite">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">Documents sent</h1>
        <p className="m-0 text-sm text-ink">
          Thank you. We have your documents and will let you know if anything else is needed.
        </p>
      </section>
    );
  const res = await publicEngine()
    .public.portal[":token"].documents.$get({ param: { token } })
    .catch(() => null);
  if (!res?.ok) {
    const code = ((await res?.json().catch(() => null)) as { code?: string } | null)?.code;
    const p = linkProblem(res?.status ?? 502, code, "portal");
    return (
      <section className="grid gap-2">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">{p.title}</h1>
        <p className="m-0 text-sm text-muted">{p.body}</p>
      </section>
    );
  }
  const s = await res.json();
  const missing = s.fields.some((f) => f.required && f.state === "needed");
  return (
    <article className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">
          {s.role === "seller" ? "Your sale" : "Your purchase"} · {s.property}
        </h1>
        <p className="m-0 text-sm text-muted">
          Upload each document below, then choose “Send my documents”. Link valid until {when(s.expiresAt)} (UAE time).
        </p>
      </header>
      {error && (
        <Banner tone="bad" role="alert">
          {uploadError(error)}
        </Banner>
      )}
      {uploaded && <Banner tone="good">Received. You can upload the next one.</Banner>}
      {s.underReview && <Banner tone="warn">Under review. Your agent will be in touch if anything is needed.</Banner>}
      {s.attention.length > 0 && (
        <Banner tone="warn">
          <ul className="m-0 grid gap-1 pl-4">
            {s.attention.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Banner>
      )}
      <ul className="m-0 grid list-none gap-4 p-0">
        {s.fields.map((f) => (
          <li key={f.kind} className="grid gap-2 rounded-card border border-line bg-raised p-4">
            <form
              action={`/b/${token}/documents/upload`}
              method="post"
              encType="multipart/form-data"
              className="grid gap-2"
            >
              <input type="hidden" name="kind" value={f.kind} />
              <div className={FIELD}>
                <label htmlFor={`file-${f.kind}`} className={LABEL}>
                  {f.label}
                  {f.required ? "" : " (optional)"} · {f.state === "received" ? "Received" : "Needed"}
                </label>
                {f.help && <p className="m-0 text-xs text-muted">{f.help}</p>}
                <input
                  id={`file-${f.kind}`}
                  name="file"
                  type="file"
                  required
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className={INPUT}
                />
                <p className="m-0 text-xs text-muted">{s.accepted}</p>
              </div>
              <div>
                <button type="submit" className={buttonClass("quiet")}>
                  {f.state === "received" ? "Replace" : "Upload"}
                </button>
              </div>
            </form>
          </li>
        ))}
      </ul>
      {missing && <p className="m-0 text-sm text-muted">Some required documents are still missing.</p>}
      <form action={sendDocuments.bind(null, token)}>
        <button type="submit" className={buttonClass("primary")}>
          Send my documents
        </button>
      </form>
      <PartyChat token={token} />
    </article>
  );
}
