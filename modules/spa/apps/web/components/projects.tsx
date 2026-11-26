import { Button, buttonClass } from "@platform/ui/button";
import { Cover } from "@platform/ui/media/cover";
import { EmptyState } from "@platform/ui/empty-state";
import { ROW_LINK, TableFrame } from "@platform/ui/page";
import { Pill } from "@platform/ui/pill";
import { Fact, FactGrid, Section, Sub } from "@platform/ui/record";
import { SET_INPUT, SET_SELECT, SET_TEXTAREA, SField, TABLE, TD, TH } from "@platform/ui/settings";
import type { SpaRole } from "@spa/core";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ProjectRecord, ProjectRow, UnitStateKey } from "../lib/contracts";
import { mediaSrc } from "../lib/media";
import { fieldWords } from "../lib/words";
import { MediaGallery } from "./inventory-photos";
import { formatMoneyFils, shortDate } from "../lib/format";
import { SPA_TEMPLATE_KIND_LIST, TEMPLATE_KIND_WORDS } from "../lib/kinds";

const STATE_WORDS: Record<UnitStateKey, string> = {
  AVAILABLE: "available",
  HELD: "held",
  SOLD: "sold",
  REGISTERED: "registered",
  HANDED_OVER: "handed over",
};
const STATE_ORDER: UnitStateKey[] = ["AVAILABLE", "HELD", "SOLD", "REGISTERED", "HANDED_OVER"];

type Action = (f: FormData) => void | Promise<void>;
/** The server actions the admin's forms call. Absent: nothing is drawn, whoever looks. */
export interface InventoryActions {
  addBuilding: Action;
  addUnit: Action;
  createPriceList: Action;
  publishPriceList: Action;
}

/** The Inventory table (design §4.6): one row per project, units by state, the price list in use. Read only. */
export function ProjectTable({ projects, unplaced }: { projects: ProjectRow[]; unplaced: number }) {
  return (
    <div className="grid gap-3">
      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet."
          body="A project, its buildings, units and price lists appear here once an admin adds the project."
        />
      ) : (
        <TableFrame>
          <table className={TABLE}>
            <caption className="sr-only">Projects</caption>
            <thead>
              <tr>
                {["Project", "Code", "Buildings", "Units", "Price list", "Handover"].map((c) => (
                  <th key={c} scope="col" className={TH}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="group">
                  <td className={TD}>
                    <span className="flex items-center gap-3">
                      <span className="block size-12 flex-none overflow-hidden rounded-xl border border-line bg-raised">
                        <Cover
                          name={p.name}
                          src={p.coverMediaId ? mediaSrc(p.coverMediaId) : undefined}
                          alt=""
                          label={false}
                        />
                      </span>
                      <span className="min-w-0">
                        <Link href={`/inventory/projects/${p.id}`} className={ROW_LINK}>
                          {p.name}
                        </Link>
                        {p.community && <Sub>{p.community}</Sub>}
                      </span>
                    </span>
                  </td>
                  <td className={`${TD} font-mono tabular-nums`}>{p.code}</td>
                  <td className={`${TD} tabular-nums`}>{p.buildings}</td>
                  <td className={TD}>
                    <span className="tabular-nums">{p.units}</span>
                    <Sub>
                      {STATE_ORDER.filter((s) => (p.byState[s] ?? 0) > 0)
                        .map((s) => `${p.byState[s]} ${STATE_WORDS[s]}`)
                        .join(" · ") || "No units yet"}
                    </Sub>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {p.priceListVersion ? (
                      `Version ${p.priceListVersion}`
                    ) : (
                      <span className="text-muted">No price list published</span>
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {p.anticipatedCompletionOn ? (
                      shortDate(p.anticipatedCompletionOn)
                    ) : (
                      <span className="text-muted">Not set</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
      {unplaced > 0 && (
        <p className="m-0 text-[12.5px] text-muted">
          {unplaced === 1 ? "1 unit is" : `${unplaced} units are`} not in a project yet. Adding a unit with the same
          code to a building places it there.
        </p>
      )}
    </div>
  );
}

/** Whole dirhams as typed ("1,500,000"; fils shown only when not whole), for a price field's starting value. */
const aedField = (fils: number | null): string =>
  fils === null ? "" : formatMoneyFils(fils).replace("AED ", "").replaceAll(",", "");

/**
 * One project (design §4.6): facts, buildings, units with status, price-list price and deal link, price lists by
 * version. The escrow account shows its last four characters, never more. Forms only for an admin, and only when the
 * page passes the actions; every other role reads. The engine checks the role again on every write.
 */
export function ProjectView({
  project: p,
  viewer,
  actions,
  units,
}: {
  project: ProjectRecord;
  viewer: SpaRole;
  actions?: InventoryActions;
  /** The Units section's body: the Units browser filtered to this project (the page builds it). */
  units: ReactNode;
}) {
  const edit = viewer === "admin" && actions ? actions : null;
  return (
    <div className="grid gap-8">
      <Section id="facts" title="Overview">
        <FactGrid>
          <Fact label="Community">{p.community ?? "Not set"}</Fact>
          <Fact label="Location">{p.location ?? "Not set"}</Fact>
          <Fact label="Handover">{p.anticipatedCompletionOn ? shortDate(p.anticipatedCompletionOn) : "Not set"}</Fact>
          <Fact label="Sales agent for new units">{p.salesAgent?.name ?? "None (sales manager's queue)"}</Fact>
          <Fact label="Template in use">
            {p.template ? `${p.template.name}, version ${p.template.version}` : "No approved template"}
          </Fact>
          <Fact label="Escrow account">
            {p.escrow ? (
              <>
                <span className="font-mono tabular-nums">{p.escrow.accountMasked}</span>
                <Sub>{p.escrow.bankName}</Sub>
              </>
            ) : (
              "No escrow account"
            )}
          </Fact>
        </FactGrid>
        {p.description && (
          <p className="m-0 max-w-[68ch] whitespace-pre-line text-sm leading-relaxed">{p.description}</p>
        )}
      </Section>

      <Section id="photos" title="Photos" hint={edit ? "Add, caption and reorder them from Edit project." : undefined}>
        <MediaGallery title={p.name} name={p.name} photos={p.media} />
      </Section>

      <Section id="buildings" title="Buildings" hint={`${p.buildings.length}`}>
        {p.buildings.length ? (
          <TableFrame>
            <table className={TABLE}>
              <caption className="sr-only">Buildings</caption>
              <thead>
                <tr>
                  {["Code", "Name", "Units"].map((c) => (
                    <th key={c} scope="col" className={TH}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.buildings.map((b) => (
                  <tr key={b.id} className="group">
                    <td className={`${TD} font-mono`}>{b.code}</td>
                    <td className={TD}>{b.name}</td>
                    <td className={`${TD} tabular-nums`}>{b.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        ) : (
          <EmptyState title="No buildings yet." body="An admin adds the project's buildings first, then its units." />
        )}
        {edit && (
          <form action={edit.addBuilding} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="projectId" value={p.id} />
            <SField label="Building code">
              <input name="code" required maxLength={40} className={`${SET_INPUT} w-36`} />
            </SField>
            <SField label="Building name">
              <input name="name" required maxLength={120} className={`${SET_INPUT} w-64`} />
            </SField>
            <Button type="submit" variant="ghost" size="sm">
              Add a building
            </Button>
          </form>
        )}
      </Section>

      <Section id="units" title="Units" hint={`${p.units.length} in this project`}>
        {units}
        {edit && p.buildings.length > 0 && (
          <form action={edit.addUnit} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="projectId" value={p.id} />
            <SField label="Building">
              <select name="buildingId" required className={`${SET_SELECT} w-44`}>
                {p.buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </select>
            </SField>
            <SField label="Unit code">
              <input name="code" required maxLength={40} className={`${SET_INPUT} w-36`} />
            </SField>
            <Button type="submit" variant="ghost" size="sm">
              Quick add
            </Button>
            <Link href={`/inventory/units/new?project=${p.id}`} className={buttonClass("ghost", "sm")}>
              New unit with details
            </Link>
          </form>
        )}
      </Section>

      <Section id="price-lists" title="Price lists" hint="A published list never changes; a new price is a new version">
        {p.priceLists.length ? (
          <TableFrame>
            <table className={TABLE}>
              <caption className="sr-only">Price lists by version</caption>
              <thead>
                <tr>
                  {["Version", "Status", "Prices", "Published", ""].map((c, i) => (
                    <th key={c || i} scope="col" className={TH}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.priceLists.map((l) => (
                  <tr key={l.id} className="group">
                    <td className={`${TD} whitespace-nowrap font-semibold`}>Version {l.version}</td>
                    <td className={TD}>
                      <span className="flex flex-wrap gap-1">
                        <Pill tone={l.status === "published" ? "accent" : "neutral"}>
                          {l.status === "published" ? "Published" : "Draft"}
                        </Pill>
                        {l.inUse && <Pill tone="waiting">In use</Pill>}
                      </span>
                    </td>
                    <td className={`${TD} tabular-nums`}>{l.prices}</td>
                    <td className={`${TD} whitespace-nowrap`}>{l.publishedAt ? shortDate(l.publishedAt) : ""}</td>
                    <td className={TD}>
                      {edit && l.status === "draft" && (
                        <form action={edit.publishPriceList}>
                          <input type="hidden" name="projectId" value={p.id} />
                          <input type="hidden" name="id" value={l.id} />
                          <Button type="submit" variant="primary" size="sm">
                            Publish version {l.version}
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        ) : (
          <EmptyState
            title="No price list yet."
            body="Units have no price-list price until a price list is published. A deal then starts at that price."
          />
        )}
        {edit && p.units.length > 0 && (
          <form action={edit.createPriceList} className="grid gap-3 rounded-xl border border-line p-3.5">
            <input type="hidden" name="projectId" value={p.id} />
            <b className="text-sm font-semibold">New price list</b>
            <p className="m-0 text-[12.5px] text-muted">
              Price in dirhams. A unit left empty has no price in this version. It is saved as a draft until you publish
              it.
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
              {p.units.map((u) => (
                <SField key={u.id} label={u.code}>
                  <input
                    name={`price_${u.id}`}
                    inputMode="decimal"
                    defaultValue={aedField(u.listPriceFils)}
                    className={SET_INPUT}
                  />
                </SField>
              ))}
            </div>
            <div>
              <Button type="submit" variant="ghost" size="sm">
                Save as a draft version
              </Button>
            </div>
          </form>
        )}
      </Section>

      <Section id="activity" title="Activity" hint="Changes to this project's details and photos">
        {p.activity.length ? (
          <ul className="m-0 grid list-none gap-2.5 p-0">
            {p.activity.map((e) => (
              <li key={e.id} className="grid grid-cols-[8.5rem_1fr] gap-3 text-sm">
                <time dateTime={e.at} className="font-mono text-xs leading-5 text-muted">
                  {shortDate(e.at)}
                </time>
                <span>
                  <b className="font-semibold">{e.label}</b>
                  {e.changed.length > 0 && <span className="text-muted">: {fieldWords(e.changed)}</span>}
                  <span className="text-muted">, {e.actor}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-muted">Nothing has changed yet.</p>
        )}
      </Section>
    </div>
  );
}

/**
 * The New and Edit project form (S75). The code and the template are set when the project is made and don't change here.
 * A field left empty clears it on Edit. Admin only: the page passes the action only to an admin.
 */
export function ProjectForm({
  action,
  project,
}: {
  action: Action;
  /** Present on Edit: the values shown and the id sent. */
  project?: ProjectRecord;
}) {
  const p = project;
  return (
    <form action={action} className="grid max-w-[980px] gap-5 rounded-2xl border border-line bg-page p-5">
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="flex flex-wrap items-start gap-3">
        {!p && (
          <SField label="Project code" help="Letters, digits, dot, dash. It can't change once a deal exists.">
            <input name="code" required maxLength={40} className={`${SET_INPUT} w-40`} />
          </SField>
        )}
        <SField label="Project name">
          <input name="name" required maxLength={120} defaultValue={p?.name ?? ""} className={`${SET_INPUT} w-72`} />
        </SField>
        <SField label="Handover date">
          <input
            type="date"
            name="anticipatedCompletionOn"
            defaultValue={p?.anticipatedCompletionOn ?? ""}
            className={`${SET_INPUT} w-44`}
          />
        </SField>
        {!p && (
          <SField label="Agreement template">
            <select name="templateKind" defaultValue="spa" className={`${SET_SELECT} w-64`}>
              {SPA_TEMPLATE_KIND_LIST.map((k) => (
                <option key={k} value={k}>
                  {TEMPLATE_KIND_WORDS[k]}
                </option>
              ))}
            </select>
          </SField>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <SField label="Community">
          <input name="community" maxLength={80} defaultValue={p?.community ?? ""} className={`${SET_INPUT} w-72`} />
        </SField>
        <SField label="Location" help="Free text, for example a district or a street. No map.">
          <input name="location" maxLength={120} defaultValue={p?.location ?? ""} className={`${SET_INPUT} w-96`} />
        </SField>
      </div>
      {p && (
        <SField
          label="Sales agent for new units"
          help="New leads and viewings for this project's units go to this person. Empty: they wait for the sales manager."
        >
          <select name="salesAgentUserId" defaultValue={p.salesAgent?.id ?? ""} className={`${SET_SELECT} w-72`}>
            <option value="">No agent (sales manager's queue)</option>
            {p.salesAgentOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </SField>
      )}
      <SField label="Description">
        <textarea
          name="description"
          rows={5}
          maxLength={2000}
          defaultValue={p?.description ?? ""}
          className={`${SET_TEXTAREA} max-w-[68ch]`}
        />
      </SField>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button type="submit" variant="primary" size="sm">
          {p ? "Save changes" : "Add the project"}
        </Button>
        <Link
          href={p ? `/inventory/projects/${p.id}` : "/inventory?tab=projects"}
          className={buttonClass("ghost", "sm")}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
