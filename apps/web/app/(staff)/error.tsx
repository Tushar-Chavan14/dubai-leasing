"use client";

export default function StaffError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="not-found">
      <h1 style={{ fontSize: 22 }}>This page couldn&apos;t load</h1>
      <p className="muted" style={{ maxWidth: "52ch" }}>
        {error.message.includes("fetch")
          ? "The engine isn't responding. Check that it is running, then try again."
          : error.message}
      </p>
      <button type="button" className="btn primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
