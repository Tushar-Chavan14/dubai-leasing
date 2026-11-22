import { Button } from "@platform/ui/button";
import { EmptyState } from "@platform/ui/empty-state";
import { ROW_LINK, TableFrame } from "@platform/ui/page";
import { Pill } from "@platform/ui/pill";
import { Fact, FactGrid, Section, Sub } from "@platform/ui/record";
import { Block, Note, Panel, SET_INPUT, SET_SELECT, SField, TABLE, TD, TH } from "@platform/ui/settings";
import type { SpaRole } from "@spa/core";
import Link from "next/link";
import type { TemplateList, TemplateRecord, TemplateVersionView } from "../lib/contracts";
import { shortDate } from "../lib/format";
import { SPA_TEMPLATE_KIND_LIST, TEMPLATE_KIND_WORDS } from "../lib/kinds";

type Action = (f: FormData) => void | Promise<void>;

const VERSION_WORDS = {
  in_review: "In review",
  approved: "In use",
  rejected: "Rejected",
  retired: "Replaced",
} as const;
const versionTone = (s: keyof typeof VERSION_WORDS): "waiting" | "accent" | "danger" | "neutral" =>
  s === "in_review" ? "waiting" : s === "approved" ? "accent" : s === "rejected" ? "danger" : "neutral";
const UPLOAD_WORDS = {
  queued: "Waiting to be read",
  reading: "Being read",
  done: "Read",
  failed: "Couldn't be read",
  needs_human: "Needs a person",
} as const;
const uploadTone = (s: keyof typeof UPLOAD_WORDS): "waiting" | "accent" | "danger" | "neutral" =>
  s === "done" ? "accent" : s === "failed" || s === "needs_human" ? "danger" : "waiting";
const kindWord = (k: string) => TEMPLATE_KIND_WORDS[k as keyof typeof TEMPLATE_KIND_WORDS] ?? k;
const scopeWords = (codes: string[]) => (codes.length ? codes.join(", ") : "Every project");

/** The Templates table (design §5): name, kind, projects, the version in use and the latest one. */
export function TemplateTable({ items }: { items: TemplateList["items"] }) {
  if (items.length === 0)
    return (
      <EmptyState
        title="No templates yet."
        body="A template is a company's own agreement wording with blanks. An admin adds one, then uploads a blank sample."
      />
    );
  return (
    <TableFrame>
      <table className={TABLE}>
        <caption className="sr-only">Templates</caption>
        <thead>
          <tr>
            {["Template", "Kind", "Projects", "In use", "Latest version"].map((c) => (
              <th key={c} scope="col" className={TH}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className="group">
              <td className={TD}>
                <Link href={`/settings/templates/${t.id}`} className={ROW_LINK}>
                  {t.name}
                </Link>
              </td>
              <td className={TD}>{kindWord(t.documentKind)}</td>
              <td className={TD}>{scopeWords(t.projectCodes)}</td>
              <td className={`${TD} whitespace-nowrap`}>
                {t.inUse ? `Version ${t.inUse.version}` : <span className="text-muted">None approved</span>}
              </td>
              <td className={`${TD} whitespace-nowrap`}>
                {t.latest ? (
                  <>
                    Version {t.latest.version}{" "}
                    <Pill tone={versionTone(t.latest.status)}>{VERSION_WORDS[t.latest.status]}</Pill>
                  </>
                ) : (
                  <span className="text-muted">No version yet</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

/** The add-a-template form (admin). The project scope is fixed here: a new scope is a new template. */
export function NewTemplateForm({ action }: { action: Action }) {
  return (
    <Panel className="p-4">
      <form action={action} className="grid gap-3.5 @container">
        <Block
          title="Add a template"
          lede="The project scope is fixed when the template is made. A different scope is a new template."
        >
          <div className="grid gap-3.5 sm:grid-cols-3">
            <SField label="Name">
              <input name="name" required maxLength={120} className={SET_INPUT} />
            </SField>
            <SField label="Kind">
              <select name="documentKind" className={SET_SELECT} defaultValue="spa">
                {SPA_TEMPLATE_KIND_LIST.map((k) => (
                  <option key={k} value={k}>
                    {TEMPLATE_KIND_WORDS[k]}
                  </option>
                ))}
              </select>
            </SField>
            <SField label="Project codes" help="Leave empty for every project. Separate codes with commas.">
              <input name="projectCodes" maxLength={400} className={SET_INPUT} />
            </SField>
          </div>
          <div>
            <Button type="submit" variant="primary" size="sm">
              Add template
            </Button>
          </div>
        </Block>
      </form>
    </Panel>
  );
}

/** One template: its facts, the upload form (admin), what was uploaded and what came of it, and its versions. */
export function TemplateRecordView({ t, canWrite, upload }: { t: TemplateRecord; canWrite: boolean; upload: Action }) {
  return (
    <div className="grid gap-6">
      <FactGrid>
        <Fact label="Kind">{kindWord(t.documentKind)}</Fact>
        <Fact label="Projects">{scopeWords(t.projectCodes)}</Fact>
        <Fact label="Added">{shortDate(t.createdAt)}</Fact>
      </FactGrid>
      {canWrite ? (
        <Section
          id="upload"
          title="Upload a sample"
          hint="A blank or fictional copy of the agreement, as a PDF up to 10 MB"
        >
          <form action={upload} className="grid max-w-xl gap-3">
            <input type="hidden" name="templateId" value={t.id} />
            <SField label="Sample agreement (PDF)">
              <input type="file" name="file" accept="application/pdf" required className={SET_INPUT} />
            </SField>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="noRealData" required className="mt-1 size-4 accent-primary" />
              <span>This sample has no real customer data. It is blank or fictional.</span>
            </label>
            <div>
              <Button type="submit" variant="primary" size="sm">
                Upload and read
              </Button>
            </div>
          </form>
        </Section>
      ) : (
        <Note>Only an admin uploads samples. You can see what was read and what is waiting for a decision.</Note>
      )}
      <Section id="uploads" title="Uploads">
        {t.uploads.length === 0 ? (
          <p className="m-0 text-sm text-muted">Nothing uploaded yet.</p>
        ) : (
          <TableFrame>
            <table className={TABLE}>
              <caption className="sr-only">Uploads</caption>
              <thead>
                <tr>
                  {["File", "When", "Result"].map((c) => (
                    <th key={c} scope="col" className={TH}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.uploads.map((u) => (
                  <tr key={u.id} className="group">
                    <td className={TD}>{u.fileName}</td>
                    <td className={`${TD} whitespace-nowrap`}>{shortDate(u.uploadedAt)}</td>
                    <td className={TD}>
                      <Pill tone={uploadTone(u.status)}>{UPLOAD_WORDS[u.status]}</Pill>
                      {u.reason && <Sub>{u.reason}</Sub>}
                      {u.versionId && (
                        <Sub>
                          <Link href={`/settings/templates/versions/${u.versionId}`} className="underline">
                            Open the version
                          </Link>
                        </Sub>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Section>
      <Section id="versions" title="Versions">
        {t.versions.length === 0 ? (
          <p className="m-0 text-sm text-muted">No version yet. A version appears once a sample has been read.</p>
        ) : (
          <TableFrame>
            <table className={TABLE}>
              <caption className="sr-only">Versions</caption>
              <thead>
                <tr>
                  {["Version", "State", "Checks", "Added"].map((c) => (
                    <th key={c} scope="col" className={TH}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.versions.map((v) => (
                  <tr key={v.id} className="group">
                    <td className={TD}>
                      <Link href={`/settings/templates/versions/${v.id}`} className={ROW_LINK}>
                        Version {v.version}
                      </Link>
                    </td>
                    <td className={TD}>
                      <Pill tone={versionTone(v.status)}>{VERSION_WORDS[v.status]}</Pill>
                    </td>
                    <td className={TD}>
                      {v.blockers === 0 && v.warnings === 0
                        ? "All passed"
                        : [v.blockers ? `${v.blockers} to fix` : "", v.warnings ? `${v.warnings} to look at` : ""]
                            .filter(Boolean)
                            .join(", ")}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{shortDate(v.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Section>
    </div>
  );
}

const SOURCE_WORDS: Record<string, string> = {
  matched: "Matched by rule",
  model: "Suggested by a model",
  empty: "Left empty",
  admin: "Chosen by an admin",
};

/**
 * One version as legal and an admin read it (S66). Everything a model proposed (headings, labels) and everything
 * read from the file is drawn as plain text by React, never as markup. Remapping is the admin's, while it is in review.
 */
export function TemplateVersionPage({ v, viewer, remap }: { v: TemplateVersionView; viewer: SpaRole; remap: Action }) {
  const canRemap = viewer === "admin" && v.canRemap;
  const fieldBlanks = v.blanks.filter((b) => b.role === "field");
  return (
    <div className="grid gap-6">
      <FactGrid>
        <Fact label="State">
          <Pill tone={versionTone(v.status)}>{VERSION_WORDS[v.status]}</Pill>
        </Fact>
        <Fact label="Kind">{kindWord(v.documentKind)}</Fact>
        <Fact label="Added">{shortDate(v.createdAt)}</Fact>
        <Fact label="Rules checked against">{v.rulesVersion}</Fact>
      </FactGrid>
      <p className="m-0 flex flex-wrap items-center gap-3 text-sm">
        <a
          href={`/settings/templates/versions/${v.id}/preview`}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-ink underline underline-offset-2"
        >
          Preview with sample values (PDF, marked SAMPLE)
        </a>
        {v.status === "in_review" && viewer === "legal" && (
          <Link href="/work?tab=inbox" className="font-semibold text-ink underline underline-offset-2">
            Decide in the inbox
          </Link>
        )}
        {v.status === "in_review" && viewer !== "legal" && (
          <span className="text-muted">Legal decides this version in the inbox.</span>
        )}
      </p>
      <Section id="checks" title="Checks" hint="Run by code against the rulebook in force">
        {v.checks.length === 0 ? (
          <p className="m-0 text-sm text-muted">Every check passed.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {v.checks.map((c, i) => (
              <li key={`${c.code}-${i}`} className="rounded-xl border border-line px-3.5 py-2.5 text-sm">
                <Pill tone={c.severity === "blocker" ? "danger" : "warning"}>
                  {c.severity === "blocker" ? "Must fix" : "Look at"}
                </Pill>{" "}
                {c.message}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section
        id="blanks"
        title="Blanks"
        hint={canRemap ? "Pick what each blank is filled from" : "What each blank is filled from"}
      >
        {fieldBlanks.length === 0 ? (
          <p className="m-0 text-sm text-muted">This template has no blanks to fill.</p>
        ) : (
          <TableFrame>
            <table className={TABLE}>
              <caption className="sr-only">Blanks</caption>
              <thead>
                <tr>
                  {["Blank", "Label", "Filled from", "How it was chosen", ...(canRemap ? ["Change"] : [])].map((c) => (
                    <th key={c} scope="col" className={TH}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fieldBlanks.map((b) => (
                  <tr key={b.id} className="group">
                    <td className={`${TD} font-mono`}>{b.id}</td>
                    <td className={TD}>
                      {b.label}
                      {b.before && <Sub>…{b.before.slice(-40)}</Sub>}
                    </td>
                    <td className={TD}>
                      {v.choices.find((c) => c.key === b.field)?.label ??
                        (b.field === "leave_empty" ? "Left empty" : b.field)}
                    </td>
                    <td className={TD}>{SOURCE_WORDS[b.source] ?? b.source}</td>
                    {canRemap && (
                      <td className={TD}>
                        <form action={remap} className="flex items-center gap-2">
                          <input type="hidden" name="versionId" value={v.id} />
                          <input type="hidden" name="blankId" value={b.id} />
                          <select
                            name="key"
                            aria-label={`Fill ${b.id} from`}
                            defaultValue={b.field}
                            className={SET_SELECT}
                          >
                            <option value="leave_empty">Leave empty</option>
                            {v.choices.map((c) => (
                              <option key={c.key} value={c.key}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" variant="ghost" size="sm">
                            Save
                          </Button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Section>
      <Section id="wording" title="Wording" hint="As read from the file. Blanks show as {{b1}}, {{b2}} …">
        <div className="grid gap-3 rounded-card border border-line p-4 text-sm">
          {v.title && <p className="m-0 font-semibold">{v.title}</p>}
          {v.sections.map((s, i) => (
            <div key={i} className="grid gap-1">
              <p className="m-0 font-semibold">{[s.number, s.heading].filter(Boolean).join(" ")}</p>
              {s.paragraphs.map((p, j) => (
                <p key={j} className="m-0 whitespace-pre-line text-muted">
                  {p}
                </p>
              ))}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
