import { PageTitle } from "@platform/ui/page";
import { ALERT } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DealType } from "@spa/core";
import { KYC_ROLE_WORDS, KycEditor } from "../../../../../components/kyc-settings";
import { engineGet } from "../../../../../lib/engine";
import { loadKycForm } from "../../../../../lib/loaders";
import { requireScreen } from "../../../../../lib/session";
import { settingsError, settingsSaved } from "../../../../../lib/settings-forms";
import { publishKycDraft, saveKycDraft } from "../actions";

export const metadata: Metadata = { title: "KYC form" };

const Role = z.enum(["buyer_person", "seller_person", "company_party", "beneficial_owner"]);

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ role: string }>;
  searchParams: Promise<{ dealType?: string; error?: string; saved?: string }>;
}) {
  const { user } = await requireScreen("settings");
  const role = Role.safeParse((await params).role);
  const sp = await searchParams;
  const dealType = sp.dealType === undefined ? null : DealType.safeParse(sp.dealType);
  if (!role.success || (dealType && !dealType.success)) notFound();
  const d = await loadKycForm(engineGet, role.data, dealType?.success ? dealType.data : null);
  if (!d) notFound();
  const note = sp.saved ? settingsSaved(sp.saved) : null;
  return (
    <div className="grid gap-6">
      <PageTitle back={{ href: "/settings/kyc", label: "KYC forms" }} title={KYC_ROLE_WORDS[d.role] ?? d.role} />
      {sp.error && (
        <p role="alert" className={ALERT.bad}>
          {settingsError(sp.error)}
        </p>
      )}
      {note && !sp.error && (
        <p role="status" className={ALERT.good}>
          {note}
        </p>
      )}
      <KycEditor d={d} canEdit={user.role === "admin"} save={saveKycDraft} publish={publishKycDraft} />
    </div>
  );
}
