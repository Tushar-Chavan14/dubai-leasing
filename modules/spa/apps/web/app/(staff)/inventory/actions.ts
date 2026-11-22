"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  buildingRequest,
  type CatalogueRequest,
  postCatalogue,
  priceListRequest,
  projectRequest,
  publishRequest,
  unitRequest,
} from "../../../lib/catalogue";
import { enginePostJson } from "../../../lib/engine";

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
): Promise<never> {
  const projectId = typeof form.get("projectId") === "string" ? (form.get("projectId") as string) : null;
  const req = build(form);
  if (!req) redirect(`${back(projectId)}?error=invalid`);
  const out = await postCatalogue(enginePostJson, req);
  if (out.result === "signin") redirect("/sign-in");
  if (out.result !== "done") redirect(`${back(projectId)}?error=${out.result}`);
  revalidatePath("/inventory");
  revalidatePath("/");
  redirect(back(projectId, out.id));
}

const projectPage = (projectId: string | null) => (projectId ? `/inventory/${projectId}` : "/inventory");

export async function createProject(form: FormData): Promise<void> {
  await run(form, projectRequest, (_p, id) => (id ? `/inventory/${id}?saved=project` : "/inventory"));
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
