import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import "./tailwind.css";
import "@platform/ui/base.css";

export const metadata: Metadata = {
  title: "Portal",
  description: "Choose a module.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-page font-sans text-ink">{children}</body>
    </html>
  );
}
