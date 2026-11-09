import Link from "next/link";
import { buttonClass } from "../components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-page px-4 py-24 text-center text-ink">
      <div className="grid justify-items-center gap-3">
        <b className="text-6xl font-semibold tracking-tight text-muted">404</b>
        <h1 className="text-2xl font-semibold">That page doesn&apos;t exist</h1>
        <p className="text-muted">It may have been moved, or the link is incomplete.</p>
        <Link href="/" className={buttonClass("ghost")}>
          Go to the overview
        </Link>
      </div>
    </main>
  );
}
