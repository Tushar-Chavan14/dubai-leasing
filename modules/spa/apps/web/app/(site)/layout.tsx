import { buttonClass } from "@platform/ui/button";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "../../components/public/brand-mark";
import { SiteNav } from "../../components/public/site-nav";
import { ThemeMenu } from "../../components/public/theme-menu";
import { THEME_COOKIE, themeOf } from "../../lib/theme";

/**
 * The public site (S78): the same bar, nav and footer as the leasing customer pages, with this module's own name. Only
 * `/properties` lives here; the buyer pages under `/b/...` keep their plain layout.
 */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const theme = themeOf((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="flex min-h-dvh flex-col bg-page font-sans text-ink">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="[position:sticky] top-0 z-30 border-b border-line bg-page/95 backdrop-blur">
        <div className="mx-auto grid w-full max-w-[1240px] grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[1fr_auto_1fr] md:px-8 md:py-4">
          <Link href="/properties" className="flex w-fit items-center gap-2 text-[17px] font-semibold tracking-tight">
            <BrandMark size={22} />
            Sales
          </Link>
          <div className="col-span-2 row-start-2 -mx-1 overflow-x-auto md:col-span-1 md:col-start-2 md:row-start-1 md:mx-0">
            <SiteNav />
          </div>
          <div className="flex items-center justify-end gap-2 md:col-start-3">
            <ThemeMenu current={theme} />
            <Link href="/properties#homes" className={buttonClass("primary", "sm")}>
              Browse homes
            </Link>
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="mt-16 border-t border-line py-7 pb-24 text-[13px] text-muted">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-2 px-4 md:px-8">
          <span className="flex items-center gap-2 font-semibold text-ink">
            <BrandMark size={18} />
            Sales
          </span>
          <span>Listings are shown with their advertising permit number.</span>
        </div>
      </footer>
    </div>
  );
}
