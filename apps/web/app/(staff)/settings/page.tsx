import type { Metadata } from "next";
import { PageTitle } from "../../../components/ui/page";
import { engine, get } from "../../../lib/engine";
import { longDate } from "../../../lib/format";
import { HubSearch } from "./hub-search";
import type { RulebookSummary } from "./rulebook/labels";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsHub() {
  const [clock, rb] = await Promise.all([
    engine("/api/demo/clock"),
    get<{ versions: RulebookSummary[] }>("/api/rulebooks"),
  ]);
  // Last changed is shown only where the data already has it: the newest rulebook version.
  const lastChanged: Record<string, string> = {};
  const newest = (rb?.versions ?? [])
    .map((v) => v.publishedAt ?? v.createdAt)
    .toSorted()
    .at(-1);
  if (newest) lastChanged["/settings/rulebook"] = longDate(newest.slice(0, 10));
  return (
    <div className="grid max-w-[960px] gap-6">
      <PageTitle
        title="Settings"
        lede="Change how leasing works for your company. Every change is logged with your name. Pick a setting to open it."
      />
      <HubSearch demo={clock.ok} lastChanged={lastChanged} />
    </div>
  );
}
