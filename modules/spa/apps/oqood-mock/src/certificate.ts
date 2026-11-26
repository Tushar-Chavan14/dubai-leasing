import { type RegistryMockProfile, simulatedCertificate } from "@platform/adapters";
import type { RegistryKind } from "@spa/core";

/**
 * The wording of every certificate this service issues (AGENTS rule 9). "Dubai Land Department" appears only inside
 * "not connected to the Dubai Land Department". Kept in one place so tests can check it.
 */
const OQOOD = {
  title: "Simulated Oqood (demo) - registration certificate",
  subline: "Demo service for testing. It is not connected to the Dubai Land Department.",
  watermark: "SIMULATED OQOOD (DEMO) - NOT A REAL REGISTRATION",
  producer: "Simulated Oqood (demo)",
} as const;

export const PROFILES: Record<RegistryKind, RegistryMockProfile> = {
  oqood_register: { systemLabel: "Simulated Oqood (demo): registration", wording: OQOOD },
  oqood_transfer: {
    systemLabel: "Simulated Oqood (demo): transfer",
    wording: {
      ...OQOOD,
      title: "Simulated Oqood (demo) - transfer certificate",
      watermark: "SIMULATED OQOOD (DEMO) - NOT A REAL TRANSFER",
    },
  },
  trustee_transfer: {
    systemLabel: "Simulated trustee transfer (demo)",
    wording: {
      title: "Simulated trustee transfer (demo) - booking confirmation",
      subline: "Demo service for testing. It is not connected to the Dubai Land Department.",
      watermark: "SIMULATED TRUSTEE TRANSFER (DEMO) - NOT A REAL TRANSFER",
      producer: "Simulated trustee transfer (demo)",
    },
  },
};

export interface CertificateData {
  kind: RegistryKind;
  registryNo: string;
  issuedOn: string;
  unitNo: string;
  buyers: string[];
  sellers: string[];
  /** AED text, e.g. "AED 1,500,000.00". */
  price: string;
  /** Trustee transfers only. */
  newTitleDeedNo?: string;
  appointmentOn?: string;
}

export function certificatePdf(d: CertificateData): Promise<Uint8Array> {
  const rows: [string, string][] = [
    ["Registry no.", d.registryNo],
    ["Issued on", d.issuedOn],
    ["Unit no.", d.unitNo],
    ["Buyers", d.buyers.join(", ")],
    ...(d.sellers.length ? ([["Sellers", d.sellers.join(", ")]] as [string, string][]) : []),
    ["Price", d.price],
    ...(d.newTitleDeedNo ? ([["New title deed", d.newTitleDeedNo]] as [string, string][]) : []),
    ...(d.appointmentOn ? ([["Appointment on", d.appointmentOn]] as [string, string][]) : []),
  ];
  return simulatedCertificate({
    profile: PROFILES[d.kind],
    documentTitle: `Simulated ${d.kind.replace("_", " ")} ${d.registryNo}`,
    watermarkSize: 18,
    rows,
  });
}
