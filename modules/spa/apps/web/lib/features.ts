/**
 * Feature checks that are plain constants, never read from the environment (M5, S79).
 *
 * `dealFormReady`: the page behind "Start deal" (`/deals/new?lead=<id>`, which reads the lead to prefill the buyer and the
 * home) arrives in M6. Until then the lead's Next step says "Deal creation comes next" and shows no link. M6 flips this.
 */
export const dealFormReady = true;
