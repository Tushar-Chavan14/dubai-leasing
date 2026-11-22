import { PageTitle } from "@platform/ui/page";
import { ALERT } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CaseDetail } from "../../../../../components/compliance-cases";
import { engineGet } from "../../../../../lib/engine";
import { loadCase } from "../../../../../lib/loaders";
import { requireScreen } from "../../../../../lib/session";
import { decideApproval } from "../../../decide";

export const metadata: Metadata = { title: "Case" };

const ERRORS: Record<string, string> = {
  note: "Say why: a rejection, a return or any outcome but Clear needs a note.",
  decision: "That decision was not understood. Choose one of the buttons.",
  refused: "The decision could not be recorded. It may already be decided, or it is not yours to decide.",
};

/** One case (design §4.8): read only except the decision card. Another role never gets here: the engine answers 403 and the page 404s. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { user } = await requireScreen("compliance");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const view = await loadCase(engineGet, id.data);
  if (!view) notFound();
  const { error } = await searchParams;
  return (
    <div className="grid gap-6">
      <PageTitle back={{ href: "/compliance#cases", label: "Compliance" }} title={`Case · ${view.dealRef}`} />
      {error && ERRORS[error] && (
        <p role="alert" className={ALERT.bad}>
          {ERRORS[error]}
        </p>
      )}
      <CaseDetail view={view} viewer={user.role} decideAction={decideApproval} />
    </div>
  );
}
