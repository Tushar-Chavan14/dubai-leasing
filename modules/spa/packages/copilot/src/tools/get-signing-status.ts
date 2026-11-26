import { z } from "zod";
import { DealIdInput, fence, RECORD_ROLES } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Output = z.object({
  envelope: z.object({ status: z.string(), completedAt: z.string().nullable() }).nullable(),
  signers: z.array(
    z.object({
      signatureId: z.string(),
      order: z.number().int(),
      role: z.string(),
      name: z.string(),
      signed: z.boolean(),
      signedAt: z.string().nullable(),
      linkExpiresAt: z.string(),
      mail: z.string().nullable(),
    }),
  ),
});
const Raw = z
  .object({
    envelope: z.object({ status: z.string(), completedAt: z.string().nullable() }),
    signers: z.array(
      z.object({
        id: z.string(),
        seq: z.number().int(),
        role: z.string(),
        name: z.string(),
        signed: z.boolean(),
        signedAt: z.string().nullable(),
        linkExpiresAt: z.string(),
        mail: z.string().nullable(),
      }),
    ),
  })
  .nullable();

export const getSigningStatus: CopilotTool<typeof DealIdInput, typeof Output> = {
  name: "get_signing_status",
  description:
    "Where the signing of a deal's agreement stands: each signer in order, whether they signed, when their link expires and whether the email went. Gives the signature id that resend_signing_link needs.",
  kind: "read",
  roles: RECORD_ROLES,
  input: DealIdInput,
  output: Output,
  async run(client, a) {
    const r = Raw.parse(await client.get(`/api/deals/${a.dealId}/signing`));
    if (!r) return { envelope: null, signers: [] };
    return Output.parse({
      envelope: { status: r.envelope.status, completedAt: r.envelope.completedAt },
      signers: r.signers.map((s) => ({
        signatureId: s.id,
        order: s.seq,
        role: s.role,
        name: fence(s.name),
        signed: s.signed,
        signedAt: s.signedAt,
        linkExpiresAt: s.linkExpiresAt,
        mail: s.mail,
      })),
    });
  },
};
