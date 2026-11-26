import { FURNISHED_LABELS, type Furnished, UNIT_TYPE_LABELS, type UnitType } from "@spa/core";
import type { ListingStateKey, UnitStateKey } from "./contracts";

/**
 * The words the inventory screens print for each code (S75). No screen shows a bare enum value, a column name or an
 * id: every code goes through one of these maps, and a test keeps each map complete.
 */
export const UNIT_TYPE_LABEL: Record<UnitType, string> = UNIT_TYPE_LABELS;

export const UNIT_STATE_LABEL: Record<UnitStateKey, string> = {
  AVAILABLE: "Available",
  HELD: "Held",
  SOLD: "Sold",
  REGISTERED: "Registered",
  HANDED_OVER: "Handed over",
};

export const LISTING_STATE_LABEL: Record<ListingStateKey, string> = {
  DRAFT: "Draft",
  VERIFIED: "Verified",
  ACTIVE: "Active",
  PUBLISHED: "Published",
  UNDER_OFFER: "Under offer",
  SOLD: "Sold",
  WITHDRAWN: "Withdrawn",
};
/** The listing record's stepper, in order. Withdrawn is not a stage: it shows as its own pill. */
export const LISTING_STAGES: readonly ListingStateKey[] = [
  "DRAFT",
  "VERIFIED",
  "ACTIVE",
  "PUBLISHED",
  "UNDER_OFFER",
  "SOLD",
];
export const OWNERSHIP_LABEL = { title_deed: "Title deed", oqood: "Oqood certificate" } as const;

export const FURNISHED_LABEL: Record<Furnished, string> = FURNISHED_LABELS;

/** 0 is a studio. */
export const bedsLabel = (n: number | null | undefined): string =>
  n === null || n === undefined ? "" : n === 0 ? "Studio" : n === 1 ? "1 bedroom" : `${n} bedrooms`;

/** The short form for a filter or a card line: "Studio", "2 bed". */
export const bedsShort = (n: number): string => (n === 0 ? "Studio" : `${n} bed`);

export const typeLabel = (t: UnitType | null | undefined): string => (t ? UNIT_TYPE_LABEL[t] : "");

/** The names an Activity line gives the fields of a changed unit or project (never the values). */
export const FIELD_LABEL: Record<string, string> = {
  type: "type",
  bedrooms: "bedrooms",
  bathrooms: "bathrooms",
  internalSqft: "internal area",
  balconySqft: "balcony area",
  floor: "floor",
  view: "view",
  parkingSpaces: "parking",
  description: "description",
  code: "code",
  buildingId: "building",
  name: "name",
  community: "community",
  location: "location",
  anticipatedCompletionOn: "handover date",
  title: "title",
  propertyDescription: "description",
  askingPriceFils: "asking price",
  sizeSqft: "size",
  unitType: "type",
  furnished: "furnishing",
  permitNo: "permit number",
  permitIssuedOn: "permit issue date",
  permitExpiresOn: "permit last valid day",
  agentUserId: "agent",
};
export const fieldWords = (changed: string[]): string => changed.map((f) => FIELD_LABEL[f] ?? "details").join(", ");

/** An area as "1,180 sq ft". */
export const sqft = (n: number | null | undefined): string => (n ? `${n.toLocaleString("en-US")} sq ft` : "");

/** Floor 0 is the ground floor and a negative one a basement. */
export const floorLabel = (n: number | null | undefined): string =>
  n === null || n === undefined ? "" : n === 0 ? "Ground floor" : n < 0 ? `Basement ${-n}` : `Floor ${n}`;
