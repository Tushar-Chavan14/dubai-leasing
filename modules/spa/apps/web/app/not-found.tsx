import { buttonClass } from "@platform/ui/button";
import { EmptyState } from "@platform/ui/empty-state";
import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto grid min-h-screen max-w-md content-center px-6">
      <EmptyState
        title="This page isn't here."
        body="It may not exist, or your role can't open it."
        action={
          <Link href="/" className={buttonClass("primary")}>
            Go to Home
          </Link>
        }
      />
    </main>
  );
}
