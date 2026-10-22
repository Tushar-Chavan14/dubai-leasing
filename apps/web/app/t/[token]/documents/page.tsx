import type { Metadata } from "next";
import Link from "next/link";
import { publicGet } from "../../../../lib/engine";
import type { ApplicationPortalView } from "../../../../lib/portal";
import { LinkGone } from "../link-gone";
import { UploadDocuments } from "./upload-documents";

export const metadata: Metadata = { title: "Upload your documents" };

export default async function DocumentsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await publicGet<ApplicationPortalView>(`/api/portal/${encodeURIComponent(token)}`);
  if (!v || v.kind !== "application" || v.purpose !== "kyc_upload") return <LinkGone />;
  if (!v.canUpload) {
    return (
      <section className="panel panel-pad stack">
        <h1 className="portal-title" style={{ fontSize: 24 }}>
          Documents received
        </h1>
        <p style={{ margin: 0 }}>
          {v.linkUsed
            ? "Your documents were sent for checking. We'll email you when that's done."
            : "This application isn't waiting for documents any more."}
        </p>
        <Link className="link" href={`/t/${token}`}>
          View your application
        </Link>
      </section>
    );
  }
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1 className="portal-title">Upload your ID documents</h1>
        <p className="muted">
          For {v.unit.label}
          {v.ref ? (
            <>
              {" "}
              (reference <span className="ref">{v.ref}</span>)
            </>
          ) : null}
          . Clear, flat photos in good light, with all four corners visible. Your documents are stored privately and
          used only to prepare your tenancy and register it in Ejari.
        </p>
      </div>
      <UploadDocuments token={token} initial={v.documents} />
    </div>
  );
}
