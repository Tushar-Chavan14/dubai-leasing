import { ENGINE_URL } from "../../../../lib/engine";

/** The contract a signer is asked to sign, fetched with their signing link. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const res = await fetch(`${ENGINE_URL}/api/portal/${encodeURIComponent(token)}/contract.pdf`, { cache: "no-store" });
  if (!res.ok) return new Response("This link has expired.", { status: 404 });
  return new Response(res.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="tenancy-contract.pdf"',
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
