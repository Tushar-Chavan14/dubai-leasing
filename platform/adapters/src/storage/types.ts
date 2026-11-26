/** Document storage on local disk outside the repo (UPLOADS_DIR). Documents are referenced by SHA-256. */
export interface DocumentStorage {
  put(bytes: Uint8Array, opts: { mime: string }): Promise<{ sha256: string; path: string }>;
  get(sha256: string): Promise<Uint8Array>;
}
