"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AskAi } from "../../../components/ask-ai";
import { Sheet } from "../../../components/ui/sheet";
import { askPrompts } from "../../../lib/ask-ai/prompts";
import { NewApplicationForm } from "../applications/new/new-application-form";

/** The "New application" form as a sheet over the Workspace. Closing it goes to `closeHref` (the URL without `new=1`). */
export function NewApplicationSheet({
  open,
  closeHref,
  units,
  today,
}: {
  open: boolean;
  closeHref: string;
  units: { id: string; label: string }[];
  today: string;
}) {
  const router = useRouter();
  const ask = askPrompts.newApplication()[0]!;
  return (
    <Sheet open={open} onClose={() => router.replace(closeHref)} title="New application">
      <div className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted">
          For walk-in or phone enquiries. The applicant gets a viewing invitation by email; their ID documents come
          later through a one-time link. Names and numbers on the contract come from those documents, not from this
          form.
        </p>
        <div>
          <AskAi prompt={ask.prompt} label={ask.label} />
        </div>
        {units.length === 0 ? (
          <p className="m-0 text-sm">
            No listed units. An application needs a listed unit with an approved asking rent.{" "}
            <Link href="/units" className="font-semibold underline">
              Go to units
            </Link>
          </p>
        ) : (
          <NewApplicationForm defaultUnit={units[0]!.id} today={today} units={units} />
        )}
      </div>
    </Sheet>
  );
}
