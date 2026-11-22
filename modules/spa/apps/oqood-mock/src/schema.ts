import type { RegistryKind, RegistryRejection } from "@spa/core";
import { bigint, bigserial, boolean, date, jsonb, pgSchema, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * The simulated Oqood and trustee registry's own Postgres schema, `oqood_mock`, in the `spa` database (S53), as leasing's
 * Ejari mock has `ejari_mock`. The SPA engine never reads these tables: it only talks to this service over HTTP, as it
 * will with the real registry.
 */
export const oqoodMock = pgSchema("oqood_mock");

export const oqdSeq = oqoodMock.sequence("oqd_seq");
export const trfSeq = oqoodMock.sequence("trf_seq");
export const tdSeq = oqoodMock.sequence("td_seq");

export const unitRecords = oqoodMock.table("unit_records", {
  unitNo: text("unit_no").primaryKey(),
  projectCode: text("project_code").notNull(),
  developerName: text("developer_name").notNull(),
  state: text("state").$type<"available" | "registered">().notNull().default("available"),
});

export const titleDeeds = oqoodMock.table("title_deeds", {
  titleDeedNo: text("title_deed_no").primaryKey(),
  unitNo: text("unit_no").notNull(),
  /** Owner names exactly as the record holds them. */
  owners: jsonb("owners").$type<string[]>().notNull(),
  /** A transfer retires the old record and issues a new one. */
  superseded: boolean("superseded").notNull().default(false),
});

export const personRecords = oqoodMock.table("person_records", {
  idNo: text("id_no").primaryKey(),
  nameEn: text("name_en").notNull(),
  expiresOn: date("expires_on").notNull(),
});

export const registrations = oqoodMock.table("registrations", {
  registryNo: text("registry_no").primaryKey(),
  kind: text("kind").$type<RegistryKind>().notNull(),
  state: text("state").notNull().default("registered"),
  unitNo: text("unit_no").notNull(),
  buyers: jsonb("buyers").$type<string[]>().notNull(),
  sellers: jsonb("sellers").$type<string[]>().notNull(),
  priceFils: bigint("price_fils", { mode: "number" }).notNull(),
  issuedOn: date("issued_on").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const trusteeBookings = oqoodMock.table("trustee_bookings", {
  bookingNo: text("booking_no").primaryKey(),
  newTitleDeedNo: text("new_title_deed_no").notNull(),
  appointmentOn: date("appointment_on").notNull(),
});

export const submissions = oqoodMock.table(
  "submissions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Null for an "unavailable" answer: a retry with the same id is a new request. */
    requestId: text("request_id"),
    kind: text("kind").$type<RegistryKind>().notNull(),
    outcome: text("outcome").$type<"issued" | "rejected" | "unavailable">().notNull(),
    registryNo: text("registry_no"),
    reasons: jsonb("reasons").$type<RegistryRejection[]>().notNull().default([]),
    unitNo: text("unit_no"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("submissions_kind_request_id_unique").on(t.kind, t.requestId)],
);
