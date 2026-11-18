import type { Metadata } from "next";
import Link from "next/link";
import { Note, PAGE, PortalTitle, SMALL_GHOST } from "../../../../components/ui/portal";
import { portalView } from "../../../../lib/engine";
import type { ApplicationPortalView } from "../../../../lib/portal";
import { LinkGone } from "../link-gone";
import { UploadDocuments } from "./upload-documents";

export const metadata: Metadata = { title: "Upload your documents" };

export default async function DocumentsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await portalView<ApplicationPortalView>(token);
  if (!v || v.kind !== "application" || v.purpose !== "kyc_upload") return <LinkGone />;
  if (!v.canUpload) {
    return (
      <div className={PAGE}>
        <PortalTitle
          title="Documents received"
          sub={
            v.linkUsed
              ? "Your documents were sent for checking. We'll email you when that's done."
              : "This application isn't waiting for documents any more."
          }
        />
        <Link className={`${SMALL_GHOST} w-fit`} href={`/t/${token}`}>
          View your application
        </Link>
      </div>
    );
  }
  return (
    <div className={PAGE}>
      <PortalTitle
        title="Upload your ID documents"
        sub={
          <>
            For {v.unit.label}
            {v.ref ? (
              <>
                {" "}
                (reference <span className="font-mono text-[13px]">{v.ref}</span>)
              </>
            ) : null}
            . Photos from your phone are fine.
          </>
        }
      />
      <Note>
        Clear, flat photos in good light, with all four corners visible. Your documents are stored privately and used
        only to prepare your tenancy and register it in Ejari.
      </Note>
      {v.form && <UploadDocuments token={token} initial={v.documents} form={v.form} />}
    </div>
  );
}
