/**
 * `@platform/adapters`: domain-free edges every module uses (S34): sending mail (SMTP or a fake), PDF rendering and
 * signature pages, local disk storage with image checks, and e-sign types. Module-specific adapters (registries,
 * chat channels, email wording) live in the module.
 */
export type * from "./esign/types.ts";
export { FakeMailer, type MailConfig, NodemailerMailer } from "./mail/nodemailer.ts";
export { type MailEvidence, mailEvidence } from "./mail/types.ts";
export type * from "./mail/types.ts";
export { type PdfBlock, renderPdf } from "./pdf/render.ts";
export {
  PdfLogoError,
  type PdfLogo,
  type PdfLook,
  renderStyledPdf,
  renderStyledPdfWithAnchors,
  type SignatureAnchor,
  type StyledBlock,
  type StyledOptions,
} from "./pdf/styled.ts";
export {
  appendSignatureRecord,
  type SignatureRecord,
  type SignatureRecordProfile,
  stampSignatures,
  type StampSigner,
} from "./pdf/signature.ts";
export { type ImageType, LocalDiskStore, sniffImage } from "./storage/local.ts";
export { stripImageMetadata } from "./storage/strip.ts";
export type * from "./storage/types.ts";
export * from "./registry-mock/index.ts";
