"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  buildingRequest,
  type CatalogueRequest,
  postCatalogue,
  priceListRequest,
  projectRequest,
  projectUpdateRequest,
  publishRequest,
  unitRequest,
} from "../../../lib/catalogue";
import { enginePostJson, engineSend } from "../../../lib/engine";

/**
 * The Inventory forms (C32, S64): each one posts to its own engine route as the signed-in user and nothing else (the
 * request builders read a fixed list of fields, never a role or a person). The engine checks the role (admin), the
 * company kind and every value again and answers 403, 409 or 422 otherwise; this is a convenience, never the rule.
 * The user comes back to the screen with one fixed word, never the engine's text.
 */
async function run(
  form: FormData,
  build: (f: FormData) => CatalogueRequest | null,
  back: (projectId: string | null, id?: string) => string,
  /** Where a refusal goes when the form names no project (the New project form). */
  fallback = "/inventory?tab=projects",
): Promise<never> {
  const projectId = typeof form.get("projectId") === "string" ? (form.get("projectId") as string) : null;
  const req = build(form);
  const failTo = (word: string) => withQuery(projectId ? back(projectId) : fallback, `error=${word}`);
  if (!req) redirect(failTo("invalid"));
  const out = await postCatalogue(enginePostJson, req);
  if (out.result === "signin") redirect("/sign-in");
  if (out.result !== "done") redirect(failTo(out.result));
  revalidatePath("/inventory");
  revalidatePath("/");
  redirect(back(projectId, out.id));
}

const withQuery = (path: string, query: string): string => `${path}${path.includes("?") ? "&" : "?"}${query}`;
const projectPage = (projectId: string | null) =>
  projectId ? `/inventory/projects/${projectId}` : "/inventory?tab=projects";

export async function createProject(form: FormData): Promise<void> {
  await run(
    form,
    projectRequest,
    (_p, id) => (id ? `/inventory/projects/${id}?saved=project` : "/inventory?tab=projects"),
    "/inventory/projects/new",
  );
}
export async function addBuilding(form: FormData): Promise<void> {
  await run(form, buildingRequest, (p, id) => (id ? `${projectPage(p)}?saved=building#buildings` : projectPage(p)));
}
export async function addUnit(form: FormData): Promise<void> {
  await run(form, unitRequest, (p, id) => (id ? `${projectPage(p)}?saved=unit#units` : projectPage(p)));
}
export async function createPriceList(form: FormData): Promise<void> {
  await run(form, priceListRequest, (p, id) => (id ? `${projectPage(p)}?saved=draft#price-lists` : projectPage(p)));
}
export async function publishPriceList(form: FormData): Promise<void> {
  // The publish form carries the list id only; the project page it came from is found again from the list.
  const from = typeof form.get("projectId") === "string" ? (form.get("projectId") as string) : null;
  await run(form, publishRequest, (_p, id) => `${projectPage(from)}${id ? "?saved=published#price-lists" : ""}`);
}

/** Saves a project's name, community, location, description and handover date (S75); fixed words on a refusal. */
export async function updateProject(form: FormData): Promise<void> {
  const req = projectUpdateRequest(form);
  if (!req) redirect(`/inventory?tab=projects&error=invalid`);
  const res = await engineSend(req.path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body),
  }).catch(() => null);
  const edit = `/inventory/projects/${req.id}/edit`;
  if (!res) redirect(`${edit}?error=refused`);
  if (res.status === 401) redirect("/sign-in");
  if (res.status === 422) redirect(`${edit}?error=invalid`);
  if (res.status < 200 || res.status >= 300) redirect(`${edit}?error=refused`);
  revalidatePath("/inventory");
  revalidatePath(`/inventory/projects/${req.id}`);
  redirect(`/inventory/projects/${req.id}?saved=updated`);
}
