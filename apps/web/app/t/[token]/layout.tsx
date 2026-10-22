import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BrandMark } from "../../../lib/icons";

// Tokens are in the URL: keep these pages out of search engines and out of Referer headers.
export const metadata: Metadata = {
  title: "My tenancy",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="portal">
      <header className="portal-top">
        <span className="brand">
          <BrandMark size={22} />
          Dubai Leasing
        </span>
        <span className="muted">Tenant portal</span>
      </header>
      <main className="portal-main">{children}</main>
      <footer className="portal-foot">
        This page is personal to you. Don&apos;t forward the link. Questions? Reply to the email you received. Demo
        build: all details are fictional.
      </footer>
    </div>
  );
}
