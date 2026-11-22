import { generatePortalKeyPair } from "@platform/kernel/portal-token";

/** Prints a new signing key pair. The private key goes only in `.env.portal.local`; each module gets the public key. */
const k = generatePortalKeyPair();
console.log("# Put this in .env.portal.local (private: never share, never commit):");
console.log(`PORTAL_SIGNING_KEY=${k.privateKey}`);
console.log("# Put this in the leasing .env:");
console.log(`LEASING_PORTAL_PUBLIC_KEY=${k.publicKey}`);
console.log("# Put this in .env.spa.local:");
console.log(`SPA_PORTAL_PUBLIC_KEY=${k.publicKey}`);
