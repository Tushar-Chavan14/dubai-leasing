"use client";

import { parseAed } from "@leasing/core";
import { useEffect, useMemo, useState } from "react";
import { aedShort, possessive } from "../../../../lib/format";
import { type Category, COMMUNITIES, subtypesFor } from "../../../../lib/portfolio";
import { Affix, Preview, SET_INPUT, SET_SELECT, SField } from "../../../../components/ui/settings";
import { Pill } from "../../../../components/ui/pill";
import { type PriceRangeView, priceRangeAction } from "../../units/actions";

/** "Try a unit": shows the allowed rent range the saved rules give a unit of this type and area. Reads only. */
export function RentTry({
  companyId,
  companyName,
  category,
  firstArea,
}: {
  companyId: string;
  companyName: string;
  category: Category;
  firstArea: string;
}) {
  const [subtype, setSubtype] = useState("");
  const [community, setCommunity] = useState(firstArea || COMMUNITIES[0] || "");
  const [bedrooms, setBedrooms] = useState("1");
  const [ask, setAsk] = useState("");
  const residential = category === "residential";
  const beds = residential ? Number(bedrooms) : null;
  const key = JSON.stringify([companyId, category, subtype, community.trim(), beds]);
  const [fetched, setFetched] = useState<{ key: string; data: PriceRangeView | null; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const enabled = community.trim() !== "";
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const t = setTimeout(async () => {
      let data: PriceRangeView | null = null;
      let failed = false;
      try {
        data = await priceRangeAction({
          companyId,
          category,
          subtype: subtype || null,
          community: community.trim(),
          bedrooms: beds,
          areaSqft: null,
        });
      } catch {
        failed = true;
      }
      if (live) setFetched({ key, data, failed });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [enabled, key, companyId, category, subtype, community, beds, attempt]);
  const loading = enabled && fetched?.key !== key;
  const data = enabled && fetched?.key === key ? fetched.data : null;
  const failed = enabled && fetched?.key === key && fetched.failed;
  const range = data?.range ?? null;
  const askFils = useMemo(() => {
    try {
      return ask.trim() ? parseAed(ask) : null;
    } catch {
      return Number.NaN;
    }
  }, [ask]);
  const amount = range
    ? range.min !== null && range.max !== null
      ? `${aedShort(range.min)} to ${aedShort(range.max)}`
      : range.min !== null
        ? `${aedShort(range.min)} or more`
        : range.max !== null
          ? `up to ${aedShort(range.max)}`
          : "any amount"
    : null;
  const verdict =
    range && askFils !== null && !Number.isNaN(askFils)
      ? (range.min !== null && askFils < range.min) || (range.max !== null && askFils > range.max)
        ? "outside"
        : "inside"
      : null;
  return (
    <Preview
      title="Try a unit"
      lede={`See the range ${possessive(companyName)} saved rules give a unit. Nothing is changed.`}
    >
      <div className="grid gap-3">
        <SField label="Type">
          <select value={subtype} onChange={(e) => setSubtype(e.target.value)} className={SET_SELECT}>
            <option value="">Any type</option>
            {subtypesFor(category).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </SField>
        <SField label="Area">
          <input
            list="try-communities"
            value={community}
            onChange={(e) => setCommunity(e.target.value)}
            className={SET_INPUT}
          />
          <datalist id="try-communities">
            {COMMUNITIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </SField>
        {residential && (
          <SField label="Bedrooms">
            <select value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} className={SET_SELECT}>
              <option value="0">Studio</option>
              {[1, 2, 3, 4, 5].map((b) => (
                <option key={b} value={b}>
                  {b} bed
                </option>
              ))}
            </select>
          </SField>
        )}
        <SField
          label="Asking rent (optional)"
          error={Number.isNaN(askFils) ? "Enter an amount like 85,000" : undefined}
        >
          <Affix unit="AED">
            <input
              inputMode="numeric"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="85,000"
              {...(Number.isNaN(askFils) ? { "aria-invalid": true } : {})}
            />
          </Affix>
        </SField>
      </div>
      <div className="grid gap-1.5 rounded-xl border border-line bg-page p-3 text-sm" aria-live="polite">
        {!enabled ? (
          <span className="text-muted">Pick an area to see the range.</span>
        ) : loading ? (
          <span className="text-muted">Checking the rules…</span>
        ) : failed ? (
          <span className="flex flex-wrap items-center gap-2 text-danger">
            Couldn&apos;t check the rules.
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-ink underline underline-offset-4"
              onClick={() => {
                setFetched(null);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
          </span>
        ) : range ? (
          <>
            <span className="text-xs text-muted">Allowed asking rent</span>
            <b className="font-mono text-[15px] tabular-nums">{amount}</b>
            {data?.sriLabel && <span className="text-xs text-muted">{data.sriLabel}</span>}
            {verdict && (
              <span>
                <Pill tone={verdict === "inside" ? "accent" : "waiting"}>
                  {verdict === "inside" ? "Inside the range" : "Outside: a manager would approve it"}
                </Pill>
              </span>
            )}
          </>
        ) : (
          <span className="text-muted">No rule fits, so a unit like this has no price range until one is added.</span>
        )}
      </div>
    </Preview>
  );
}
