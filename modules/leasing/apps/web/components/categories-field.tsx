import type { PropertyCategory } from "@leasing/core";

const CATEGORIES: { value: PropertyCategory; label: string }[] = [
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
  { value: "retail", label: "Retail" },
];

/** Checkbox group named `categories`: the property types a company leases. */
export function CategoriesField({ selected, error }: { selected: PropertyCategory[]; error?: string | undefined }) {
  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0" data-field="categories" data-label="Offers for lease">
      <legend className="sr-only">Offers for lease</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {CATEGORIES.map((c) => (
          <label key={c.value} className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" name="categories" value={c.value} defaultChecked={selected.includes(c.value)} />
            {c.label}
          </label>
        ))}
      </div>
      {error && <span className="text-xs text-danger">{error}</span>}
    </fieldset>
  );
}
