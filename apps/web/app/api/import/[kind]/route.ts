import { revalidatePath } from "next/cache";
import { ENGINE_URL, sessionToken } from "../../../../lib/engine";

const KINDS = ["leases", "units"] as const;

/**
 * CSV import from the browser: forwards the file (or pasted rows) to the engine as the signed-in
 * user. A route handler rather than a server action, so files over the 1 MB action body limit
 * still go through (the engine accepts up to 2 MB).
 */
export async function POST(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  if (!KINDS.includes(kind as (typeof KINDS)[number]))
    return Response.json({ error: "Unknown import" }, { status: 404 });
  const token = await sessionToken();
  if (!token) return Response.json({ error: "Sign in again to import." }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file");
  const pasted = String(form.get("csv") ?? "");
  const csv = file instanceof File && file.size > 0 ? await file.text() : pasted;
  if (!csv.trim()) return Response.json({ error: "Choose a CSV file or paste the rows." }, { status: 400 });
  const res = await fetch(`${ENGINE_URL}/api/import/${kind}`, {
    method: "POST",
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ csv }),
  });
  const body = await res.json().catch(() => ({ error: `Engine returned ${res.status}` }));
  if (res.status === 403)
    return Response.json({ error: `Only admins and leasing managers can import ${kind}.` }, { status: 403 });
  if (res.ok) revalidatePath("/", "layout");
  return Response.json(body, { status: res.status });
}
