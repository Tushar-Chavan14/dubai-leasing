import type { Metadata } from "next";
import Link from "next/link";
import { RowAction } from "../../../../components/row-action";
import { Empty, PageHead } from "../../../../components/ui";
import { get } from "../../../../lib/engine";
import { IconBuilding } from "../../../../lib/icons";
import { KIND_LABEL } from "../../../../lib/portfolio";
import type { CompanyRow, Me } from "../../../../lib/types";
import { setCompanyActive } from "./actions";
import { CompanyForm } from "./company-form";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const [rows, me] = await Promise.all([get<CompanyRow[]>("/api/companies"), get<Me>("/api/me")]);
  const isAdmin = me?.role === "admin";
  const list = rows ?? [];
  return (
    <>
      <PageHead
        title="Settings"
        lede="Companies own units. Rent rules and contract rules are set per company, so each one can price and contract in its own way."
      />
      {isAdmin && (
        <div className="settings-add">
          <CompanyForm />
        </div>
      )}
      <section className="panel">
        {list.length === 0 ? (
          <Empty icon={<IconBuilding />} title="No companies yet">
            {isAdmin ? "Add the first company, then give it rent rules." : "An admin adds companies here."}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Kind</th>
                  <th>Legal details</th>
                  <th className="num">Units</th>
                  <th>Status</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{KIND_LABEL[c.kind] ?? c.kind}</td>
                    <td className={c.legalComplete ? undefined : "muted"}>
                      <Link href={`/settings/companies/${c.id}`}>
                        {c.legalComplete ? "Complete" : "Incomplete: add"}
                      </Link>
                    </td>
                    <td className="num">{c.unitCount}</td>
                    <td className={c.active ? undefined : "muted"}>{c.active ? "Active" : "Inactive"}</td>
                    {isAdmin && (
                      <td className="nowrap">
                        <RowAction
                          action={setCompanyActive}
                          fields={{ id: c.id, active: String(!c.active) }}
                          label={c.active ? "Deactivate" : "Reactivate"}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
