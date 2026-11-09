import type { Metadata } from "next";
import { AskAi, AskAiMenu } from "../../../../components/ask-ai";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Pill } from "../../../../components/ui/pill";
import { FormGrid, Panel, Preview, SetPage, TABLE, TD, TH } from "../../../../components/ui/settings";
import { askPrompts } from "../../../../lib/ask-ai/prompts";
import { get } from "../../../../lib/engine";
import { aedShort, bedroomsLabel, longDate } from "../../../../lib/format";
import type { Me } from "../../../../lib/types";
import { SriForm } from "./sri-form";

export const metadata: Metadata = { title: "Smart Rental Index" };

interface SriRow {
  id: string;
  community: string;
  bedrooms: number;
  avgAnnualRentFils: number;
  source: "mock" | "manual";
  effectiveFrom: string;
}

export default async function SriPage() {
  const [rows, me] = await Promise.all([get<SriRow[]>("/api/sri"), get<Me>("/api/me")]);
  const canEdit = me?.role === "admin" || me?.role === "leasing_manager";
  const list = rows ?? [];
  return (
    <SetPage
      title="Smart Rental Index"
      lede="The official DLD averages by community and size. Rent rules set each company's band around these values, and the renewal helper uses them for the legal rent cap. A value recorded on a lease overrides the table for that lease."
      actions={<AskAiMenu label="Ask AI" prompts={askPrompts.settingsPage("Smart Rental Index")} />}
    >
      <FormGrid
        preview={
          <Preview
            title="Add or update a value"
            lede={
              canEdit
                ? "A change applies from today and affects notices drafted from now on, not ones already approved."
                : undefined
            }
          >
            {canEdit ? (
              <>
                <SriForm />
                <div>
                  <AskAi label="Ask AI to add an SRI value" prompt="Add a Smart Rental Index value of AED " />
                </div>
              </>
            ) : (
              <p className="m-0 text-[13px] text-muted">
                Admins and leasing managers can update the table. Officers can record a value on a lease.
              </p>
            )}
            <p className="m-0 border-t border-line pt-3 text-[13px] text-muted">
              Demo values are fictional. In production, take averages from the DLD Smart Rental Index.
            </p>
          </Preview>
        }
      >
        {list.length === 0 ? (
          <EmptyState title="No SRI values yet" body="Without one, renewals are offered at the current rent." />
        ) : (
          <Panel className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Community</th>
                  <th className={TH}>Size</th>
                  <th className={`${TH} text-right`}>Average annual rent</th>
                  <th className={TH}>From</th>
                  <th className={TH}>Source</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="group">
                    <td className={`${TD} font-semibold`}>{r.community}</td>
                    <td className={TD}>{bedroomsLabel(r.bedrooms)}</td>
                    <td className={`${TD} text-right font-mono tabular-nums`}>{aedShort(r.avgAnnualRentFils)}</td>
                    <td className={`${TD} whitespace-nowrap`}>{longDate(r.effectiveFrom)}</td>
                    <td className={TD}>
                      <Pill tone={r.source === "mock" ? "neutral" : "accent"}>
                        {r.source === "mock" ? "Demo table" : "Entered by staff"}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </FormGrid>
    </SetPage>
  );
}
