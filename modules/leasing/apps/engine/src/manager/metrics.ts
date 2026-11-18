import { type CalendarDate, diffDays, toDubaiDate } from "@leasing/core";
import {
  applications,
  conversations,
  deadlines,
  depositStatements,
  ejariSubmissions,
  inspections,
  leases,
  outboundMessages,
  payments,
  type Tx,
  units,
} from "@leasing/db";
import { and, eq, inArray, isNotNull, like } from "drizzle-orm";

/**
 * The five KPIs from the guide (docs/specs.md §8), computed from records only. Each metric
 * returns its headline figure, how many cases it covers, and the rows behind it so a person can
 * check the number.
 */
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = xs.toSorted((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

export async function leasingMetrics(tx: Tx, today: CalendarDate) {
  const all = await tx.db
    .select({
      id: leases.id,
      ref: leases.ref,
      endOn: leases.endOn,
      ejariIssuedOn: leases.ejariIssuedOn,
      unit: units.code,
      applicationId: leases.applicationId,
    })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId));
  const refOf = new Map(all.map((l) => [l.id, l.ref]));

  // 1. Enquiry → registered lease: first contact (the Telegram conversation, else the application) to Ejari issued.
  const issued = all.filter((l) => l.ejariIssuedOn && l.applicationId);
  const apps = issued.length
    ? await tx.db
        .select({ id: applications.id, createdAt: applications.createdAt, source: applications.source })
        .from(applications)
        .where(
          inArray(
            applications.id,
            issued.map((l) => l.applicationId!),
          ),
        )
    : [];
  const convs = issued.length
    ? await tx.db
        .select({ applicationId: conversations.applicationId, createdAt: conversations.createdAt })
        .from(conversations)
        .where(
          inArray(
            conversations.applicationId,
            issued.map((l) => l.applicationId!),
          ),
        )
    : [];
  const toRegistered = issued
    .map((l) => {
      const a = apps.find((x) => x.id === l.applicationId);
      const c = convs.find((x) => x.applicationId === l.applicationId);
      const start = c?.createdAt ?? a?.createdAt;
      if (!start) return null;
      return {
        lease: l.ref,
        from: c ? "enquiry" : "application",
        startedOn: toDubaiDate(start),
        ejariIssuedOn: l.ejariIssuedOn!,
        days: diffDays(toDubaiDate(start), l.ejariIssuedOn!),
      };
    })
    .filter((r) => r !== null);

  // 2. Ejari rejection rate: rejected answers / answered submissions (issued or rejected).
  const subs = await tx.db
    .select({ leaseId: ejariSubmissions.leaseId, status: ejariSubmissions.status })
    .from(ejariSubmissions)
    .where(inArray(ejariSubmissions.status, ["issued", "rejected"]));
  const perLease = new Map<string, { submissions: number; rejected: number }>();
  for (const s of subs) {
    const p = perLease.get(s.leaseId) ?? { submissions: 0, rejected: 0 };
    p.submissions++;
    if (s.status === "rejected") p.rejected++;
    perLease.set(s.leaseId, p);
  }
  const rejected = subs.filter((s) => s.status === "rejected").length;

  // 3. Notices on time: leases whose T−100 send date has passed, and whether a notice went out by then.
  const sendDue = await tx.db
    .select({ leaseId: deadlines.entityId, milestone: deadlines.milestone, dueOn: deadlines.dueOn })
    .from(deadlines)
    .where(like(deadlines.milestone, "notice_send@%"));
  const notices = await tx.db
    .select({
      entityId: outboundMessages.entityId,
      milestone: outboundMessages.milestone,
      sentAt: outboundMessages.sentAt,
    })
    .from(outboundMessages)
    .where(and(eq(outboundMessages.purpose, "notice"), isNotNull(outboundMessages.sentAt)));
  const noticeRows = sendDue
    .filter((d) => d.dueOn <= today)
    .map((d) => {
      const termEnd = d.milestone.split("@")[1]!;
      const sent = notices
        .filter((n) => n.entityId === d.leaseId && n.milestone.startsWith(`renewal_notice@${termEnd}`))
        .map((n) => toDubaiDate(n.sentAt!))
        .toSorted()[0];
      return {
        lease: refOf.get(d.leaseId) ?? d.leaseId,
        termEnd,
        sendBy: d.dueOn,
        sentOn: sent ?? null,
        onTime: !!sent && sent <= d.dueOn,
      };
    });

  // 4. Rent overdue: days past due for each open overdue or bounced instalment.
  const open = await tx.db
    .select({
      leaseId: payments.leaseId,
      seq: payments.seq,
      dueOn: payments.dueOn,
      amountFils: payments.amountFils,
      status: payments.status,
    })
    .from(payments)
    .where(inArray(payments.status, ["overdue", "bounced"]));
  const overdue = open
    .map((p) => ({
      lease: refOf.get(p.leaseId) ?? p.leaseId,
      seq: p.seq,
      dueOn: p.dueOn,
      amountFils: p.amountFils,
      status: p.status,
      days: diffDays(p.dueOn, today),
    }))
    .toSorted((a, b) => b.days - a.days);

  // 5. Deposit return time: move-out inspection done → refund paid.
  const paid = await tx.db
    .select({ leaseId: depositStatements.leaseId, paidOn: depositStatements.paidOn, doneOn: inspections.doneOn })
    .from(depositStatements)
    .innerJoin(inspections, eq(inspections.id, depositStatements.inspectionId))
    .where(and(eq(depositStatements.status, "paid"), isNotNull(inspections.doneOn)));
  const returns = paid.map((p) => ({
    lease: refOf.get(p.leaseId) ?? p.leaseId,
    inspectedOn: p.doneOn!,
    paidOn: p.paidOn!,
    days: diffDays(p.doneOn!, p.paidOn!),
  }));

  return {
    today,
    enquiryToRegistered: {
      medianDays: median(toRegistered.map((r) => r.days)),
      count: toRegistered.length,
      rows: toRegistered,
    },
    ejariRejectionRate: {
      percent: subs.length ? Math.round((rejected * 1000) / subs.length) / 10 : null,
      rejected,
      submissions: subs.length,
      rows: [...perLease].map(([id, p]) => ({ lease: refOf.get(id) ?? id, ...p })),
    },
    noticesOnTime: {
      percent: noticeRows.length
        ? Math.round((noticeRows.filter((r) => r.onTime).length * 1000) / noticeRows.length) / 10
        : null,
      onTime: noticeRows.filter((r) => r.onTime).length,
      due: noticeRows.length,
      rows: noticeRows,
    },
    rentOverdue: {
      open: overdue.length,
      maxDays: overdue[0]?.days ?? null,
      totalFils: overdue.reduce((s, p) => s + p.amountFils, 0),
      rows: overdue,
    },
    depositReturn: { medianDays: median(returns.map((r) => r.days)), count: returns.length, rows: returns },
  };
}
