/** What the engine's portal API returns for an application link (no staff data, nothing masked away needed). */
export interface ApplicationPortalView {
  kind: "application";
  purpose: "application" | "viewing" | "kyc_upload" | "offer";
  linkUsed: boolean;
  firstName: string;
  ref: string | null;
  state: string;
  unit: { label: string; community: string };
  documents: { id: string; kind: string; side: string | null; bytes: number | null }[];
  canUpload: boolean;
  offer: {
    revision: number;
    annualRentFils: number;
    cheques: number;
    depositFils: number;
    reservationFils: number;
    moveInOn: string;
    startOn: string;
    endOn: string;
    expiresOn: string;
    acceptedAt: string | null;
  } | null;
  canRespond: boolean;
  reservationRecorded: boolean;
  viewingAt: string | null;
  viewingOutcome: "attended" | "no_show" | null;
  /** Unit facts for the property page; only on `viewing` and `application` links. */
  property: {
    building: string;
    community: string;
    unitNo: string | null;
    bedrooms: number | null;
    bathrooms: number | null;
    areaSqft: number | null;
    floor: number | null;
    furnished: boolean | null;
    parkingSpaces: number | null;
    description: string | null;
    askingRentFils: number | null;
    virtualTourUrl: string | null;
    photos: { id: string; caption: string | null }[];
  } | null;
}

/** Where an application is, in the applicant's words. */
export const APPLICANT_STAGES = [
  { key: "viewing", label: "Viewing" },
  { key: "docs", label: "Documents" },
  { key: "check", label: "Checks" },
  { key: "offer", label: "Offer" },
  { key: "reserve", label: "Reservation" },
  { key: "contract", label: "Contract" },
] as const;

export function stageIndex(v: ApplicationPortalView): number {
  if (v.state === "CONVERTED" || v.state === "RESERVED") return 5;
  if (v.state === "OFFER") return v.offer?.acceptedAt ? 4 : 3;
  if (v.state === "SCREENING") return v.linkUsed || v.purpose !== "kyc_upload" ? 2 : 1;
  return 0; // ENQUIRY, VIEWING
}

/** What the engine's portal API returns for a signing link (ID numbers masked). */
export interface SignPortalView {
  kind: "sign";
  purpose: "sign";
  demo: boolean;
  linkUsed: boolean;
  role: "tenant" | "landlord";
  signerName: string;
  signedAt: string | null;
  leaseRef: string;
  canSign: boolean;
  contract: {
    version: number;
    status: string;
    sha256: string;
    fields: {
      tenantNameEn: string;
      tenantKind: "individual" | "company";
      tenantEmiratesIdNo: string | null;
      tenantPassportNo: string | null;
      tenantTradeLicenceNo: string | null;
      landlordNameEn: string;
      building: string;
      community: string;
      unitNo: string;
      dldPropertyNo: string;
      makaniNo: string;
      startOn: string;
      endOn: string;
      moveInOn: string;
      annualRentFils: number;
      cheques: number;
      depositFils: number;
      rentFreeDays: number;
    };
    addendum: { clauses: string[]; freeText: string | null };
  };
}
