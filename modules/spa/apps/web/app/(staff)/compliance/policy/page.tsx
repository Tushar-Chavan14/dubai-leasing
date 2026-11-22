import { PageTitle } from "@platform/ui/page";
import { ALERT } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AmlPolicyForm } from "../../../../components/aml-policy";
import { engineGet } from "../../../../lib/engine";
import { loadAmlPolicy } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";
import { publishAmlPolicy } from "./actions";

export const metadata: Metadata = { title: "Compliance rules" };

const ERRORS: Record<string, string> = {
  invalid: "That wasn't published. Check every value; a sanctions match always flags.",
  exists: "Someone published at the same moment. Look again and try once more.",
  refused: "That wasn't published. Only the compliance officer publishes these rules.",
};

/** The compliance rules page (S42, S66): the compliance officer publishes, the MLRO reads. Nobody else has it. */
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireScreen("compliance");
  const p = await loadAmlPolicy(engineGet);
  if (!p) notFound();
  const { error, saved } = await searchParams;
  return (
    <div className="grid gap-6">
      <PageTitle
        back={{ href: "/compliance", label: "Compliance" }}
        title="Compliance rules"
        lede="The AML rules: warning signs, countries, cut-offs and when parties are checked again. Code applies them; no model scores or clears anything."
      />
      {error && (
        <p role="alert" className={ALERT.bad}>
          {ERRORS[error] ?? "That wasn't published. Try again."}
        </p>
      )}
      {saved === "policy" && !error && (
        <p role="status" className={ALERT.good}>
          Published as a new version.
        </p>
      )}
      <AmlPolicyForm p={p} action={publishAmlPolicy} />
    </div>
  );
}
