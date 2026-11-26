import type { ReactNode } from "react";

/** Public pages (design.md §7.5): no sign-in, no staff shell. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 py-10 max-sm:px-4">
      {children}
    </main>
  );
}
