import type { Metadata } from "next";
import Link from "next/link";
import { Arrow, Cover } from "../../../components/public/cover";
import { type PublicUnitSummary, factsList } from "../../../lib/listings";
import { publicEngine } from "../../../lib/public";

export const metadata: Metadata = { title: "Properties" };

export default async function PropertiesPage() {
  const r = await publicEngine<PublicUnitSummary[]>("/public/units");
  const units = r.ok ? r.data : [];
  return (
    <div className="pub-wrap">
      <section className="pub-intro">
        <h1 className="pub-h">Homes you can view this week</h1>
        <p>
          Every home here is ready to see. Pick one, choose a viewing time and we email your invitation straight away.
          Prefer to talk it through? Chat with us any time.
        </p>
      </section>
      {!r.ok ? (
        <p className="pub-empty" role="alert">
          We couldn&apos;t load the homes just now. Refresh the page in a moment.
        </p>
      ) : units.length === 0 ? (
        <p className="pub-empty">
          No homes are open for viewing right now. Chat with us and we&apos;ll tell you when one is.
        </p>
      ) : (
        <ul className="pub-grid">
          {units.map((u) => (
            <li key={u.id}>
              <Link href={`/properties/${u.id}`} className="pub-card">
                <div className="pub-card-frame">
                  <Cover building={u.building} photo={u.photoUrls[0]} className="pub-card-img" />
                  <div className="pub-card-over">
                    <div>
                      <h2>{u.building}</h2>
                      <p>{u.description ?? u.community}</p>
                    </div>
                    <span className="pub-card-arrow">
                      <Arrow />
                    </span>
                  </div>
                </div>
                <div className="pub-card-meta">
                  <span>
                    {u.community} · {factsList(u).join(" · ")}
                  </span>
                  <b>{u.rent}</b>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
