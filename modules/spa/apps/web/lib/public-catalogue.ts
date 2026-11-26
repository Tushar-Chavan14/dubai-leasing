import { PublicProperty, PublicPropertyDetail } from "@spa/core";
import { z } from "zod";
import { engineUrl } from "./env";

/**
 * The public site's reads and words (S78). The engine's allow-listed shape is parsed again here, so a field the engine
 * didn't name can never reach a page. Nothing here knows a seller, a document or a floor price.
 */

const Catalogue = z.object({
  items: z.array(PublicProperty),
  facets: z.object({ communities: z.array(z.string()), types: z.array(z.string()) }),
});
export type Catalogue = z.infer<typeof Catalogue>;
export type Loaded<T> = { ok: true; data: T } | { ok: false; status: number };

async function load<S extends z.ZodType>(path: string, schema: S): Promise<Loaded<z.infer<S>>> {
  try {
    const res = await fetch(`${engineUrl()}${path}`, { cache: "no-store" });
    if (!res.ok) return { ok: false, status: res.status };
    const parsed = schema.safeParse(await res.json());
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, status: 502 };
  } catch {
    return { ok: false, status: 0 };
  }
}

export const loadCatalogue = (query: string): Promise<Loaded<Catalogue>> =>
  load(`/public/catalogue${query ? `?${query}` : ""}`, Catalogue);
export const loadProperty = (ref: string): Promise<Loaded<PublicPropertyDetail>> =>
  load(`/public/catalogue/${encodeURIComponent(ref)}`, PublicPropertyDetail);

/** The free viewing times of a public home (S79), as ISO instants; empty when none or when the engine is down. */
export async function loadSlots(ref: string): Promise<string[]> {
  const r = await load(`/public/catalogue/${encodeURIComponent(ref)}/slots`, z.object({ slots: z.array(z.string()) }));
  return r.ok ? r.data.slots : [];
}
