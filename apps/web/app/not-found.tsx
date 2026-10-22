import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <div className="not-found">
        <b>404</b>
        <h1 style={{ fontSize: 22 }}>That page doesn&apos;t exist</h1>
        <p className="muted">It may have been moved, or the link is incomplete.</p>
        <Link href="/" className="btn">
          Go to the overview
        </Link>
      </div>
    </main>
  );
}
