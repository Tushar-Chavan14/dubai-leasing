"use server";

import { revalidatePath } from "next/cache";
import { engine, formError } from "../../../../lib/engine";

export interface RegistrationActionState {
  ok?: boolean;
  message?: string;
}

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const fail = (r: Parameters<typeof formError>[0]): RegistrationActionState => {
  const e = formError(r);
  return { ok: false, message: [e.error, ...e.reasons].join(" ") };
};

/** The portal refused the registration: record the reasons. Fields: leaseId, submissionId, reasons. */
export async function recordRegistrationRejected(
  _prev: RegistrationActionState,
  formData: FormData,
): Promise<RegistrationActionState> {
  const leaseId = text(formData, "leaseId");
  const r = await engine(`/api/leases/${encodeURIComponent(leaseId)}/registration/rejected`, {
    method: "POST",
    body: JSON.stringify({ submissionId: text(formData, "submissionId"), reasons: text(formData, "reasons") }),
  });
  if (!r.ok) return fail(r);
  revalidatePath(`/leases/${leaseId}`);
  return { ok: true, message: "Rejection recorded. A task is open to fix and register again." };
}

/**
 * The portal issued a reference; no certificate file at hand. Fields: leaseId, submissionId, reference, issuedOn
 * (YYYY-MM-DD), feePaidAed (optional). The certificate can be added by the form that streams the PDF instead.
 */
export async function recordRegistrationNoCertificate(
  _prev: RegistrationActionState,
  formData: FormData,
): Promise<RegistrationActionState> {
  const leaseId = text(formData, "leaseId");
  const body = new FormData();
  for (const k of ["submissionId", "reference", "issuedOn", "feePaidAed"]) {
    const v = text(formData, k);
    if (v) body.set(k, v);
  }
  const r = await engine(`/api/leases/${encodeURIComponent(leaseId)}/registration/record`, {
    method: "POST",
    body,
  });
  if (!r.ok) return fail(r);
  revalidatePath(`/leases/${leaseId}`);
  return { ok: true, message: "Registration recorded." };
}
