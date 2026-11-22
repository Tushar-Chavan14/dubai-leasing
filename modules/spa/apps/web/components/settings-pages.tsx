import { ALERT, Panel, SaveBar, SET_INPUT, SET_SELECT, SettingRow } from "@platform/ui/settings";
import { Button } from "@platform/ui/button";
import { Pill } from "@platform/ui/pill";
import type { SpaRole } from "@spa/core";
import type { CompanyView, DemoClockView, PlansView, RulebookView, SigningView, UsersView } from "../lib/contracts";
import { bpsToPct, formRoleKey, settingsError, settingsSaved } from "../lib/settings-forms";
import { formatMoneyFils, shareLabel, weekdayDate } from "../lib/format";

type Action = (f: FormData) => void | Promise<void>;

/** The one error and the one saved note a Settings page can show: fixed words, never the engine's. */
export function Notices({
  error,
  saved,
  savedText,
}: {
  error?: string | undefined;
  saved?: string | undefined;
  savedText?: string;
}) {
  const note = saved ? (savedText ?? settingsSaved(saved)) : null;
  return (
    <>
      {error && (
        <p role="alert" className={ALERT.bad}>
          {settingsError(error)}
        </p>
      )}
      {note && !error && (
        <p role="status" className={ALERT.good}>
          {note}
        </p>
      )}
    </>
  );
}

const KIND_WORDS = { developer: "Developer", brokerage: "Brokerage", both: "Developer and brokerage" } as const;
const AUTHORITY_WORDS = { poa: "Power of attorney", board_resolution: "Board resolution" } as const;

export function CompanyForm({ data, canEdit, action }: { data: CompanyView; canEdit: boolean; action: Action }) {
  return (
    <div className="grid gap-6">
      {canEdit ? (
        <form action={action} className="grid gap-4">
          <Panel className="px-4">
            <SettingRow title="Company name" sub="As it appears on agreements." htmlFor="name">
              <input
                id="name"
                name="name"
                defaultValue={data.company.name}
                maxLength={200}
                required
                className={`${SET_INPUT} w-72`}
              />
            </SettingRow>
            <SettingRow
              title="What the company does"
              sub="Developers have inventory, brokerages have listings."
              htmlFor="kind"
            >
              <select id="kind" name="kind" defaultValue={data.company.kind} className={`${SET_SELECT} w-64`}>
                {Object.entries(KIND_WORDS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </SettingRow>
          </Panel>
          <SaveBar note="The change is logged with your name.">
            <Button type="submit" variant="primary" size="sm">
              Save company details
            </Button>
          </SaveBar>
        </form>
      ) : (
        <Panel className="px-4">
          <SettingRow title="Company name">
            <span className="text-sm">{data.company.name || "Not set"}</span>
          </SettingRow>
          <SettingRow title="What the company does">
            <span className="text-sm">{KIND_WORDS[data.company.kind]}</span>
          </SettingRow>
        </Panel>
      )}
      <section className="grid gap-2">
        <h2 className="m-0 text-base font-semibold text-ink">Companies and who signs for them</h2>
        <p className="m-0 text-sm text-muted">
          Adding a signatory stays in the deal flow, where the document that lets the person sign is uploaded.
        </p>
        {data.signatories.length === 0 ? (
          <p className="m-0 text-sm text-muted">No companies yet.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {data.signatories.map((c, i) => (
              <li key={`${c.companyName}-${i}`} className="rounded-card border border-line p-3">
                <p className="m-0 font-semibold text-ink">{c.companyName}</p>
                {c.signatories.length === 0 ? (
                  <p className="m-0 text-sm text-muted">No signatory yet.</p>
                ) : (
                  <ul className="m-0 mt-1 list-none p-0 text-sm">
                    {c.signatories.map((s, j) => (
                      <li key={j}>
                        {s.name}, {s.title} <span className="text-muted">({AUTHORITY_WORDS[s.authority]})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Num({
  id,
  name,
  value,
  min,
  max,
  unit,
  step,
  disabled,
}: {
  id: string;
  name: string;
  value: string | number;
  min?: number;
  max?: number;
  unit: string;
  step?: string;
  disabled: boolean;
}) {
  return (
    <span className="flex items-center gap-2">
      <input
        id={id}
        name={name}
        type={step ? "number" : "text"}
        inputMode={step ? "decimal" : "numeric"}
        {...(step ? { step } : {})}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        defaultValue={value}
        disabled={disabled}
        className={`${SET_INPUT} w-24`}
      />
      <span className="text-sm text-muted">{unit}</span>
    </span>
  );
}

export function PlansForm({ data, canEdit, action }: { data: PlansView; canEdit: boolean; action: Action }) {
  const v = data.values;
  const d = !canEdit;
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="baseVersion" value={data.version} />
      <Panel className="px-4">
        <SettingRow
          title="Largest discount off the list price"
          sub="Off-plan: a price below this needs a manager."
          htmlFor="maxDiscount"
        >
          <Num
            id="maxDiscount"
            name="maxDiscount"
            value={bpsToPct(v.maxDiscountBps)}
            step="0.01"
            min={0}
            max={100}
            unit="%"
            disabled={d}
          />
        </SettingRow>
        <SettingRow title="Commission, seller side" htmlFor="commissionSeller">
          <Num
            id="commissionSeller"
            name="commissionSeller"
            value={bpsToPct(v.commission.sellerSideBps)}
            step="0.01"
            min={0}
            max={100}
            unit="%"
            disabled={d}
          />
        </SettingRow>
        <SettingRow title="Commission, buyer side" htmlFor="commissionBuyer">
          <Num
            id="commissionBuyer"
            name="commissionBuyer"
            value={bpsToPct(v.commission.buyerSideBps)}
            step="0.01"
            min={0}
            max={100}
            unit="%"
            disabled={d}
          />
        </SettingRow>
        <SettingRow title="Security deposit (resale)" sub="A share of the price." htmlFor="deposit">
          <Num
            id="deposit"
            name="deposit"
            value={bpsToPct(v.depositBps)}
            step="0.01"
            min={0}
            max={100}
            unit="%"
            disabled={d}
          />
        </SettingRow>
        <SettingRow title="Days a unit is held for a booking" htmlFor="holdDays">
          <Num id="holdDays" name="holdDays" value={v.holdDays} min={1} max={60} unit="days" step="1" disabled={d} />
        </SettingRow>
        <SettingRow title="Days the sellers have to answer an offer" htmlFor="offerDays">
          <Num
            id="offerDays"
            name="offerDays"
            value={v.offerValidityDays}
            min={1}
            max={30}
            unit="days"
            step="1"
            disabled={d}
          />
        </SettingRow>
        <SettingRow
          title="Instalment reminders: days before"
          sub="Furthest first, for example 14, 3."
          htmlFor="remindBefore"
        >
          <Num
            id="remindBefore"
            name="remindBefore"
            value={v.instalmentReminders.beforeDays.join(", ")}
            unit="days"
            disabled={d}
          />
        </SettingRow>
        <SettingRow
          title="Instalment reminders: days after"
          sub="Nearest first, for example 1, 5."
          htmlFor="remindAfter"
        >
          <Num
            id="remindAfter"
            name="remindAfter"
            value={v.instalmentReminders.afterDays.join(", ")}
            unit="days"
            disabled={d}
          />
        </SettingRow>
      </Panel>
      {canEdit && (
        <SaveBar note="Saving makes a new version. Deals already running keep the version they started with.">
          <Button type="submit" variant="primary" size="sm">
            Save plans
          </Button>
        </SaveBar>
      )}
    </form>
  );
}

const ORDER_TYPES = [
  ["primary_offplan", "Primary off-plan"],
  ["resale_ready", "Ready resale"],
  ["resale_offplan", "Off-plan resale"],
] as const;

export function SigningForm({ data, canEdit, action }: { data: SigningView; canEdit: boolean; action: Action }) {
  const d = !canEdit;
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="baseVersion" value={data.version} />
      <Panel className="px-4">
        <SettingRow
          title="Days a signing link stays valid"
          sub="Counted from the day it is emailed."
          htmlFor="signingLinkDays"
        >
          <Num
            id="signingLinkDays"
            name="signingLinkDays"
            value={data.values.signingLinkDays}
            min={1}
            max={60}
            unit="days"
            step="1"
            disabled={d}
          />
        </SettingRow>
        {ORDER_TYPES.map(([t, label]) => (
          <SettingRow key={t} title={`Who signs first: ${label}`} htmlFor={`order_${t}`}>
            <select
              id={`order_${t}`}
              name={`order_${t}`}
              defaultValue={data.values.signingOrder[t]?.[0] === "seller" ? "seller_first" : "buyer_first"}
              disabled={d}
              className={`${SET_SELECT} w-44`}
            >
              <option value="buyer_first">Buyer first</option>
              <option value="seller_first">Seller first</option>
            </select>
          </SettingRow>
        ))}
      </Panel>
      {canEdit && (
        <SaveBar note="Saving makes a new version. Deals already running keep the version they started with.">
          <Button type="submit" variant="primary" size="sm">
            Save signing settings
          </Button>
        </SaveBar>
      )}
    </form>
  );
}

export function FeesView({ data }: { data: RulebookView }) {
  const p = data.feePreview;
  return (
    <div className="grid gap-6">
      <p className="m-0 text-sm text-muted">
        Version <span className="font-semibold text-ink">{data.rulesVersion}</span>, in force from{" "}
        {weekdayDate(data.effectiveFrom)}. These values are set by legal. They can&apos;t be changed here.
      </p>
      <Panel className="px-4">
        {data.items.map((i) => (
          <SettingRow key={i.key} title={i.label}>
            {i.status === "pending" ? (
              <Pill tone="warning">Pending</Pill>
            ) : (
              <span className="text-sm tabular-nums">
                {i.kind === "bps"
                  ? shareLabel(i.bps)
                  : i.kind === "fils"
                    ? formatMoneyFils(i.amountFils ?? 0)
                    : (i.value ?? "").replace(/_/g, " ")}
              </span>
            )}
          </SettingRow>
        ))}
      </Panel>
      <Panel className="px-4 py-3">
        <h2 className="m-0 text-base font-semibold text-ink">Registration fee on {formatMoneyFils(p.priceFils)}</h2>
        {p.status === "ready" ? (
          <ul className="m-0 mt-2 list-none p-0 text-sm tabular-nums">
            <li>Total: {formatMoneyFils(p.totalFils ?? 0)}</li>
            <li>Buyer pays: {formatMoneyFils(p.buyerFils ?? 0)}</li>
            <li>Seller pays: {formatMoneyFils(p.sellerFils ?? 0)}</li>
          </ul>
        ) : (
          <p className="m-0 mt-2 text-sm text-muted">
            <Pill tone="warning">Pending</Pill> The preview shows once legal has confirmed who pays the fee.
          </p>
        )}
      </Panel>
      <section className="grid gap-1">
        <h2 className="m-0 text-base font-semibold text-ink">Where these values come from</h2>
        <ul className="m-0 list-none p-0 text-sm text-muted">
          {data.sources.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Words for the roles on the Users page. The second compliance role reads neutrally, like every other page an admin opens. */
const ROLE_WORDS: Record<SpaRole, string> = {
  sales_officer: "Sales officer",
  sales_manager: "Sales manager",
  sales_admin: "Sales admin",
  legal: "Legal",
  finance: "Finance",
  compliance_officer: "Compliance officer",
  mlro: "Compliance lead",
  admin: "Admin",
};

export function UsersTable({ data, setRole, setActive }: { data: UsersView; setRole: Action; setActive: Action }) {
  return (
    <Panel className="overflow-x-auto">
      <ul className="m-0 list-none p-0">
        {data.items.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="m-0 font-semibold text-ink">
                {u.name} {u.isYou && <Pill tone="neutral">You</Pill>}
              </p>
              <p className="m-0 text-sm text-muted">{ROLE_WORDS[u.role]}</p>
            </div>
            <Pill tone={u.active ? "accent" : "neutral"}>{u.active ? "Active" : "Inactive"}</Pill>
            {!u.isYou && (
              <>
                <form action={setRole} className="flex items-center gap-2">
                  <input type="hidden" name="userId" value={u.id} />
                  <select
                    name="role"
                    defaultValue={formRoleKey(u.role)}
                    aria-label={`Role for ${u.name}`}
                    className={`${SET_SELECT} w-48`}
                  >
                    {(Object.keys(ROLE_WORDS) as SpaRole[]).map((r) => (
                      <option key={r} value={formRoleKey(r)}>
                        {ROLE_WORDS[r]}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="ghost" size="sm">
                    Change role
                  </Button>
                </form>
                <form action={setActive}>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="active" value={u.active ? "no" : "yes"} />
                  <Button type="submit" variant={u.active ? "danger" : "ghost"} size="sm">
                    {u.active ? "Deactivate" : "Reactivate"}
                  </Button>
                </form>
              </>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const STATUS_PILL = {
  in_use: { tone: "accent", label: "In use" },
  connected: { tone: "accent", label: "Connected" },
  simulated: { tone: "warning", label: "Simulated" },
  not_set_up: { tone: "neutral", label: "Not set up" },
} as const;

export function StatusList({
  items,
}: {
  items: { key: string; label: string; status: keyof typeof STATUS_PILL; tag?: string | null }[];
}) {
  return (
    <Panel className="px-4">
      {items.map((i) => (
        <SettingRow key={i.key} title={i.label} sub={i.tag ? <code>{i.tag}</code> : undefined}>
          <Pill tone={STATUS_PILL[i.status].tone}>{STATUS_PILL[i.status].label}</Pill>
        </SettingRow>
      ))}
    </Panel>
  );
}

export function ClockPanel({ data, action }: { data: DemoClockView; action: Action }) {
  return (
    <div className="grid gap-4">
      <Panel className="px-4 py-3">
        <p className="m-0 text-sm text-muted">The demo date is</p>
        <p className="m-0 text-lg font-semibold text-ink">{weekdayDate(data.today)}</p>
        <p className="m-0 text-sm text-muted">
          {data.offsetDays === 0 ? "Not moved: this is today." : `${data.offsetDays} days ahead of today.`}
        </p>
      </Panel>
      <form action={action} className="flex flex-wrap items-center gap-2">
        {[1, 7, 30].map((n) => (
          <Button key={n} type="submit" name="days" value={String(n)} variant="ghost" size="sm">
            {n === 1 ? "1 day ahead" : `${n} days ahead`}
          </Button>
        ))}
        <Button type="submit" name="rewind" value="yes" variant="primary" size="sm">
          Back to today
        </Button>
      </form>
      <form action={action} className="flex items-center gap-2">
        <label htmlFor="days" className="text-sm text-ink">
          Set it this many days ahead (1 to 365)
        </label>
        <input id="days" name="days" inputMode="numeric" className={`${SET_INPUT} w-24`} />
        <Button type="submit" variant="ghost" size="sm">
          Set
        </Button>
      </form>
    </div>
  );
}
