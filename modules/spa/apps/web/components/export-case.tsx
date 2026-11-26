import { buttonClass } from "@platform/ui/button";

/**
 * "Export a case pack" on the Compliance screen (C23, S62), for the compliance roles only (the engine refuses everyone
 * else). A deal is named by its reference; the web app's own route finds it and forwards the signed-in session.
 */
export function ExportCaseForm() {
  return (
    <form method="post" action="/compliance/export" className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-[13px] font-semibold text-ink">
        Deal reference
        <input
          name="ref"
          required
          maxLength={20}
          pattern="D-[0-9]{4,}"
          placeholder="D-0001"
          autoComplete="off"
          className="h-9 rounded-full border border-line bg-page px-4 font-sans text-sm font-normal text-ink"
        />
      </label>
      <button type="submit" className={buttonClass("ghost", "sm")}>
        Export case pack
      </button>
      <span className="text-xs text-muted">
        A ZIP with the summary, documents, screenings, decisions and a manifest. Each export is logged.
      </span>
    </form>
  );
}
