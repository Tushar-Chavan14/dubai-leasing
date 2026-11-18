import { EMIRATE_LABELS, EMIRATES, type Emirate } from "@leasing/core";

/** Checkbox group named `emirates`: the emirates a company operates in. */
export function EmiratesField({ selected, error }: { selected: Emirate[]; error?: string | undefined }) {
  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0" data-field="emirates" data-label="Operates in">
      <legend className="sr-only">Operates in</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {EMIRATES.map((e) => (
          <label key={e} className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" name="emirates" value={e} defaultChecked={selected.includes(e)} />
            {EMIRATE_LABELS[e]}
          </label>
        ))}
      </div>
      {error && <span className="text-xs text-danger">{error}</span>}
    </fieldset>
  );
}
