import { fileURLToPath } from "node:url";

/** The repository root (this file is modules/leasing/apps/engine/src/repo-root.ts). Relative storage dirs start here. */
export const repoRoot = fileURLToPath(new URL("../../../../..", import.meta.url));
