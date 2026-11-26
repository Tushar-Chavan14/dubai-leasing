import { newId } from "@platform/kernel/ids";
import { ALERT_DEFAULT_HOURS, alertText, AlertThresholds, COMPLIANCE_GATES, COMPLIANCE_REVIEW_KEY, isComplianceGate, isComplianceRole, type AlertLevel, type SpaGateId, type SpaRole, spaGates, hasRole, rolesOf } from "@spa/core";
import { alertSettings, alerts, deals, type SpaDb, spaApprovals, spaUsers, withSpaTx } from "@spa/db";
import { gateAlertMail } from "@spa/helpers";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { SpaContext } from "./context.ts";
import { forbidden, notFound, takingVersion, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { scrub, sendSpaMail } from "./mail.ts";
import { POLICY_ENTITY } from "./policy.ts";

type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };
const MS_HOUR = 3_600_000;
const COMPLIANCE_GATE_LIST = [...COMPLIANCE_GATES] as SpaGateId[];

/** The threshold in force for every gate: the highest saved version, else the default in code. */
export async function currentThresholds(db: SpaDb): Promise<Record<SpaGateId, { hours: number; version: number }>> {
  const rows = await db.select().from(alertSettings).orderBy(desc(alertSettings.version));
  const out = {} as Record<SpaGateId, { hours: number; version: number }>;
  for (const g of Object.keys(ALERT_DEFAULT_HOURS) as SpaGateId[])
    out[g] = { hours: ALERT_DEFAULT_HOURS[g], version: 0 };
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.gate)) continue;
    seen.add(r.gate);
    out[r.gate] = { hours: r.thresholdHours, version: r.version };
  }
  return out;
}

const keyGates = (key: string): SpaGateId[] =>
  key === COMPLIANCE_REVIEW_KEY ? COMPLIANCE_GATE_LIST : [key as SpaGateId];

/**
 * Settings → Alerts, as an admin or a compliance role reads it (S62). The three compliance gates are one entry
 * "Compliance review": nobody outside the compliance roles reads their names (S42), and the admin sets all three at once.
 */
export async function getAlertSettings(ctx: SpaContext, user: Person) {
  if (!hasRole(user, "admin") && !isComplianceRole(rolesOf(user))) throw forbidden("you can't view these settings");
  const th = await currentThresholds(ctx.database.db);
  const gates = (Object.keys(ALERT_DEFAULT_HOURS) as SpaGateId[]).filter((g) => !isComplianceGate(g));
  const entry = (key: string, label: string, gate: SpaGateId) => ({
    key,
    label,
    hours: th[gate].hours,
    isDefault: th[gate].version === 0,
    version: th[gate].version,
  });
  return [
    ...gates.map((g) => entry(g, spaGates[g].label, g)),
    entry(COMPLIANCE_REVIEW_KEY, "Compliance review", "aml_flag"),
  ];
}

/** An admin saves thresholds in hours. A new version per gate that changed; the same value again writes nothing. */
export async function setAlertSettings(ctx: SpaContext, user: Person, input: unknown): Promise<{ changed: number }> {
  if (!hasRole(user, "admin")) throw forbidden("only an admin changes alert settings");
  const parsed = AlertThresholds.safeParse(input);
  if (!parsed.success)
    throw unprocessable(
      "invalid_alert_settings",
      "the alert settings aren't valid",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  return takingVersion(() =>
    withSpaTx(ctx.database, async (tx) => {
      const th = await currentThresholds(tx.db);
      let changed = 0;
      for (const [key, hours] of Object.entries(parsed.data)) {
        const gates = keyGates(key);
        if (gates.every((g) => th[g].hours === hours)) continue;
        changed++;
        for (const g of gates)
          await tx.db.insert(alertSettings).values({
            gate: g,
            version: th[g].version + 1,
            thresholdHours: hours,
            setBy: user.id,
            setAt: ctx.clock.now(),
          });
      }
      if (changed)
        await appendDealEvent(tx, ctx, {
          entity: POLICY_ENTITY,
          type: "ALERT_SETTINGS_SET",
          actor: `user:${user.id}`,
          // Never names a gate: a change to a compliance gate must not show in a staff-visible event.
          payload: { changed },
        });
      return { changed };
    }),
  );
}

/**
 * Who is alerted. The approver role first; at twice the threshold the manager too: the sales manager for an ordinary gate,
 * the MLRO for a compliance gate. A user already alerted for this approval is not alerted again at the other level.
 */
const recipientRole = (gate: SpaGateId, approverRole: SpaRole, level: AlertLevel): SpaRole =>
  level === "approver" ? approverRole : isComplianceGate(gate) ? "mlro" : "sales_manager";

/**
 * The hourly sweep (S30, S62): for each pending approval waiting at least its gate's threshold, the approver role gets an
 * in-app row and an email; at twice the threshold the manager too. Each (approval, level, user) is alerted once, so a second
 * run changes nothing. The words are `alertText`: the gate label, the deal ref and the hours; a compliance gate reads one
 * generic sentence and goes to compliance roles only. No model. A mail that fails leaves the in-app row.
 */
export async function runAlerts(ctx: SpaContext): Promise<{ created: number }> {
  const db = ctx.database.db;
  const now = ctx.clock.now();
  const th = await currentThresholds(db);
  const pending = await db.select().from(spaApprovals).where(eq(spaApprovals.status, "pending"));
  let created = 0;
  for (const a of pending) {
    const hours = Math.floor((now.getTime() - a.createdAt.getTime()) / MS_HOUR);
    const limit = th[a.gate].hours;
    const levels: AlertLevel[] = hours >= limit * 2 ? ["approver", "manager"] : hours >= limit ? ["approver"] : [];
    if (!levels.length) continue;
    const [deal] =
      a.entityKind === "deal" ? await db.select({ ref: deals.ref }).from(deals).where(eq(deals.id, a.entityId)) : [];
    const compliance = isComplianceGate(a.gate);
    const text = alertText({ gate: a.gate, dealRef: deal?.ref ?? null, hours });
    const already = new Set(
      (await db.select({ userId: alerts.userId }).from(alerts).where(eq(alerts.approvalId, a.id))).map((r) => r.userId),
    );
    for (const level of levels) {
      const role = recipientRole(a.gate, a.approverRole, level);
      const users = await db
        .select({ id: spaUsers.id, email: spaUsers.email })
        .from(spaUsers)
        .where(and(eq(spaUsers.role, role), eq(spaUsers.active, true)));
      for (const u of users) {
        // A compliance gate never goes to a role outside compliance, whatever the approver role says.
        if (compliance && !isComplianceRole(role)) continue;
        if (already.has(u.id)) continue;
        const id = newId();
        const made = await db
          .insert(alerts)
          .values({ id, approvalId: a.id, level, userId: u.id, waitedHours: hours, createdAt: now })
          .onConflictDoNothing()
          .returning({ id: alerts.id });
        already.add(u.id);
        if (!made.length) continue;
        created++;
        if (!ctx.mail) continue;
        try {
          const sent = await sendSpaMail(ctx, {
            entityKind: "approval",
            entityId: a.id,
            purpose: "notice",
            milestone: `alert:${level}:${u.id}`,
            to: u.email,
            parts: gateAlertMail({
              text,
              dealRef: compliance ? null : (deal?.ref ?? null),
              url: `${ctx.mail.webBaseUrl}/`,
            }),
          });
          await db.update(alerts).set({ outboundMessageId: sent.outboundId }).where(eq(alerts.id, id));
        } catch (e) {
          console.error("alert mail not sent:", scrub(e instanceof Error ? e.message : String(e)));
        }
      }
    }
  }
  return { created };
}

export interface AlertItem {
  id: string;
  text: string;
  level: AlertLevel;
  dealId: string | null;
  dealRef: string | null;
  createdAt: string;
  readAt: string | null;
}

/**
 * The signed-in user's alerts, newest first (S62). The text is built here from the gate, the ref and the hours; a compliance
 * alert is dropped for anyone outside the compliance roles even if a row were theirs.
 */
export async function listAlerts(
  ctx: SpaContext,
  user: Person,
  limit = 50,
): Promise<{ items: AlertItem[]; unread: number }> {
  const db = ctx.database.db;
  const rows = await db
    .select({
      id: alerts.id,
      level: alerts.level,
      hours: alerts.waitedHours,
      createdAt: alerts.createdAt,
      readAt: alerts.readAt,
      gate: spaApprovals.gate,
      entityKind: spaApprovals.entityKind,
      entityId: spaApprovals.entityId,
    })
    .from(alerts)
    .innerJoin(spaApprovals, eq(spaApprovals.id, alerts.approvalId))
    .where(eq(alerts.userId, user.id))
    .orderBy(desc(alerts.createdAt), desc(alerts.id));
  const visible = rows.filter((r) => !isComplianceGate(r.gate) || isComplianceRole(rolesOf(user)));
  const dealIds = [...new Set(visible.filter((r) => r.entityKind === "deal").map((r) => r.entityId))];
  const refs = new Map(
    dealIds.length
      ? (await db.select({ id: deals.id, ref: deals.ref }).from(deals).where(inArray(deals.id, dealIds))).map((d) => [
          d.id,
          d.ref,
        ])
      : [],
  );
  const items = visible.slice(0, limit).map((r) => {
    const dealRef = r.entityKind === "deal" ? (refs.get(r.entityId) ?? null) : null;
    return {
      id: r.id,
      text: alertText({ gate: r.gate, dealRef, hours: r.hours }),
      level: r.level,
      dealId: r.entityKind === "deal" ? r.entityId : null,
      dealRef,
      createdAt: r.createdAt.toISOString(),
      readAt: r.readAt?.toISOString() ?? null,
    };
  });
  return { items, unread: visible.filter((r) => !r.readAt).length };
}

/** Marks one of your own alerts read. Another user's alert, or none, is a 404; reading twice changes nothing. */
export async function markAlertRead(ctx: SpaContext, user: Person, alertId: string): Promise<void> {
  const db = ctx.database.db;
  const [row] = await db.select({ id: alerts.id, userId: alerts.userId }).from(alerts).where(eq(alerts.id, alertId));
  if (!row || row.userId !== user.id) throw notFound("alert");
  await db
    .update(alerts)
    .set({ readAt: ctx.clock.now() })
    .where(and(eq(alerts.id, alertId), isNull(alerts.readAt)));
}
