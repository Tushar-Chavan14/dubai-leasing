"use client";

import { Button } from "../../components/ui/button";

export default function StaffError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="grid justify-items-center gap-3 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">This page couldn&apos;t load</h1>
      <p className="max-w-[52ch] text-muted">
        {error.message.includes("fetch")
          ? "The engine isn't responding. Check that it is running, then try again."
          : error.message}
      </p>
      <Button variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
