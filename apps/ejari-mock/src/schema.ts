import type { EjariPayload, EjariRejection } from "@leasing/core";
import { bigint, bigserial, date, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The simulated registry's own Postgres schema, `ejari_mock`, in the same local database as the
 * engine (decision D22). The engine never reads these tables: it only talks to this service over
 * HTTP, as it will with the real registry.
 */
export const ejariMock = pgSchema("ejari_mock");

export const ejariSeq = ejariMock.sequence("ejari_seq");

export const properties = ejariMock.table("properties", {
  dldPropertyNo: text("dld_property_no").primaryKey(),
  unitNo: text("unit_no").notNull(),
  makaniNo: text("makani_no").notNull(),
  plotNo: text("plot_no"),
  usage: text("usage").notNull().default("residential"),
  ownerName: text("owner_name").notNull(),
});

export const icpPeople = ejariMock.table("icp_people", {
  idNo: text("id_no").primaryKey(),
  idType: text("id_type").notNull(),
  nameEn: text("name_en").notNull(),
  nationality: text("nationality"),
  expiresOn: date("expires_on").notNull(),
});

export const registrations = ejariMock.table("registrations", {
  ejariNo: text("ejari_no").primaryKey(),
  dldPropertyNo: text("dld_property_no").notNull(),
  tenantIdNo: text("tenant_id_no").notNull(),
  tenantName: text("tenant_name").notNull(),
  landlordName: text("landlord_name").notNull(),
  startOn: date("start_on").notNull(),
  endOn: date("end_on").notNull(),
  annualRentFils: bigint("annual_rent_fils", { mode: "number" }).notNull(),
  state: text("state").notNull().default("active"),
  /** The submitted contract; `{ prior: true }` for the seeded registrations of imported demo leases. */
  payload: jsonb("payload").$type<EjariPayload | { prior: true }>().notNull(),
  issuedOn: date("issued_on").notNull(),
  cancelledOn: date("cancelled_on"),
  cancelReason: text("cancel_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const submissions = ejariMock.table("submissions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  requestId: text("request_id").unique(),
  kind: text("kind").notNull(),
  outcome: text("outcome").notNull(),
  ejariNo: text("ejari_no"),
  reasons: jsonb("reasons").$type<EjariRejection[]>().notNull().default([]),
  payload: jsonb("payload").$type<EjariPayload>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
