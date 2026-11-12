import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { THEME_COOKIE, themeOf } from "../lib/theme";
import "./tailwind.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "UAE Leasing", template: "%s | UAE Leasing" },
  description: "Leasing desk for Dubai residential portfolios: approvals, leases, units and legal deadlines.",
  icons: { icon: "/icon.svg" },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = themeOf((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
