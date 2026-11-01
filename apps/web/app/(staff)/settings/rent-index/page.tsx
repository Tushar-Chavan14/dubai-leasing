import type { Metadata } from "next";
import { AskAi } from "../../../../components/ask-ai";
import { Empty, PageHead } from "../../../../components/ui";
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
    <>
      <PageHead
        title="Smart Rental Index"
        lede="The official DLD averages by community and size. Rent rules set each company's band around these values, and the renewal helper uses them for the legal rent cap. A value recorded on a lease overrides the table for that lease."
      />
      <div className="split">
        <section className="panel">
          {list.length === 0 ? (
            <Empty title="No SRI values yet">Without one, renewals are offered at the current rent.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Community</th>
                    <th>Size</th>
                    <th className="num">Average annual rent</th>
                    <th>From</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id}>
                      <td>{r.community}</td>
                      <td>{bedroomsLabel(r.bedrooms)}</td>
                      <td className="num">{aedShort(r.avgAnnualRentFils)}</td>
                      <td className="nowrap">{longDate(r.effectiveFrom)}</td>
                      <td className="muted">{r.source === "mock" ? "Demo table" : "Entered by staff"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <aside className="panel panel-pad">
          <h2 className="section-title">Add or update a value</h2>
          {canEdit ? (
            <>
              <SriForm />
              <div style={{ marginTop: 12 }}>
                <AskAi label="Ask AI to add an SRI value" prompt="Add a Smart Rental Index value of AED " />
              </div>
            </>
          ) : (
            <p className="muted">
              Admins and leasing managers can update the table. Officers can record a value on a lease.
            </p>
          )}
          <div className="divider" />
          <p className="muted" style={{ fontSize: 13 }}>
            Demo values are fictional. In production, take averages from the DLD Smart Rental Index. A change applies
            from today and affects notices drafted from now on, not ones already approved.
          </p>
        </aside>
      </div>
    </>
  );
}
