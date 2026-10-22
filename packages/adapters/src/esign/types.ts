/**
 * E-signature. The MVP signs in the tenant portal (decision D22): each signer gets a single-use
 * link, types their name and consents; the engine records the evidence and appends a signature
 * record page (`appendSignatureRecord`) to the approved PDF, storing the signed copy's hash.
 * A real provider can implement this interface later.
 */
export interface ESignAdapter {
  requestSignature(r: {
    documentSha256: string;
    signers: { name: string; email: string }[];
  }): Promise<{ envelopeId: string }>;
  status(envelopeId: string): Promise<{ signed: boolean; signedSha256?: string }>;
}
