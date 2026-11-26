"use client";

import { useRouter } from "next/navigation";
import { type Category, CATEGORIES } from "../lib/portfolio";

/** Category switch for the rule lists; keeps the category in the URL so a reload stays put. */
export function CategoryControl({
  value,
  base,
  params = {},
  offered,
}: {
  value: Category;
  /** Categories to show (the selected company's); all when omitted. */
  offered?: Category[] | undefined;
  base: string;
  /** Other URL params to keep (company, emirate). */
  params?: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <div
      role="radiogroup"
      aria-label="Category"
      className="flex w-fit max-w-full flex-wrap gap-1 rounded-full bg-raised p-[3px]"
    >
      {CATEGORIES.filter((c) => !offered || offered.includes(c.value)).map((c) => (
        <label
          key={c.value}
          className="cursor-pointer rounded-full px-3.5 py-1.5 font-sans text-[13px] text-muted has-[:checked]:bg-page has-[:checked]:font-semibold has-[:checked]:text-ink has-[:checked]:shadow-[0_1px_2px_rgb(0_0_0/0.08)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink"
        >
          <input
            type="radio"
            name="category"
            checked={value === c.value}
            onChange={() => router.push(`${base}?${new URLSearchParams({ ...params, category: c.value }).toString()}`)}
            className="sr-only"
          />
          <span>{c.label}</span>
        </label>
      ))}
    </div>
  );
}
