import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { THEME_COOKIE, themeOf } from "../lib/theme";
import "./tailwind.css";
import "@platform/ui/base.css";

export const metadata: Metadata = {
  title: { default: "Sales", template: "%s | Sales" },
  description: "Sales desk: deals, listings, compliance and agreements.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = themeOf((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-page font-sans text-ink">{children}</body>
    </html>
  );
}
