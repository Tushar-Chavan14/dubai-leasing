import { type RegistryMockProfile, simulatedCertificate } from "@platform/adapters";

export interface CertificateData {
  system?: "ejari" | "tawtheeq";
  ejariNo: string;
  issuedOn: string;
  dldPropertyNo: string;
  unitNo: string;
  makaniNo: string;
  tenantName: string;
  landlordName: string;
  startOn: string;
  endOn: string;
  annualRent: string;
}

/** The visible wording per system, kept in one place so tests can check it (PDF streams are compressed). */
export const CERTIFICATE_WORDING = {
  ejari: {
    title: "Tenancy registration certificate (simulated)",
    subline: "Demo service for testing. It is not connected to the Dubai Land Department.",
    watermark: "SIMULATED - NOT ISSUED BY DUBAI LAND DEPARTMENT",
    producer: "Simulated Ejari (demo)",
  },
  tawtheeq: {
    title: "Tenancy contract registration (simulated Tawtheeq)",
    subline: "Demo service for testing. It is not connected to any Abu Dhabi government system.",
    watermark: "SIMULATED - NOT ISSUED BY ANY ABU DHABI AUTHORITY",
    producer: "Simulated Tawtheeq (demo)",
  },
} as const;

/** The two simulated registries' wording as shell profiles (the shell itself lives in `@platform/adapters`). */
export const REGISTRY_PROFILES: Record<"ejari" | "tawtheeq", RegistryMockProfile> = {
  ejari: { systemLabel: "Ejari (simulated)", wording: CERTIFICATE_WORDING.ejari },
  tawtheeq: { systemLabel: "Tawtheeq (simulated)", wording: CERTIFICATE_WORDING.tawtheeq },
};

/**
 * A plain demo certificate, watermarked SIMULATED on the page. Grey type only: no DLD logo,
 * colours, layout or wording (AGENTS rule 9).
 */
export function certificatePdf(d: CertificateData): Promise<Uint8Array> {
  const twq = d.system === "tawtheeq";
  return simulatedCertificate({
    profile: REGISTRY_PROFILES[twq ? "tawtheeq" : "ejari"],
    documentTitle: `Simulated tenancy registration ${d.ejariNo}`,
    watermarkSize: twq ? 22 : 26,
    rows: [
      ["Registration no.", d.ejariNo],
      ["Issued on", d.issuedOn],
      ["Property no.", d.dldPropertyNo],
      ["Unit no.", d.unitNo],
      ["Makani no.", d.makaniNo],
      ["Tenant", d.tenantName],
      ["Landlord", d.landlordName],
      ["Period", `${d.startOn} to ${d.endOn}`],
      ["Annual rent", d.annualRent],
    ],
  });
}
