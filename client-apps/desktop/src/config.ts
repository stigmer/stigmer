/**
 * Public Stigmer web console URL (no trailing slash).
 *
 * The desktop app renders from a Tauri origin, so anything that must be
 * reachable by other people or by the system browser — an agent's chat
 * links, OAuth callback pages — points at the web console instead.
 * Overridable per environment via `VITE_STIGMER_CONSOLE_URL`.
 */
export const CONSOLE_URL: string = (
  import.meta.env.VITE_STIGMER_CONSOLE_URL ?? "https://app.stigmer.ai"
).replace(/\/$/, "");

/**
 * The server a build talks to until the person chooses another
 * (`VITE_STIGMER_API_URL`; a build that sets none talks to a local
 * server). Only a default: the person's choice, which the Rust host keeps
 * (src-tauri/src/server.rs), wins, and the server itself says whether and
 * how to sign in (server/connect.ts). Nothing about sign-in is decided
 * from this address.
 */
export function buildDefaultServer(): string {
  return import.meta.env.VITE_STIGMER_API_URL || "http://localhost:7234";
}
