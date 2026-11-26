/**
 * The incoming request's headers inside a server action (it has no Request of its own), or none when the framework has no
 * request here. Loaded on demand so a module that only imports this never needs the framework at import time.
 */
export async function requestHeaders(): Promise<Headers> {
  try {
    const { headers } = await import("next/headers");
    return await headers();
  } catch {
    return new Headers();
  }
}
