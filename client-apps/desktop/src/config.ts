/**
 * Public Stigmer web console URL (no trailing slash).
 *
 * The desktop app renders from a Tauri origin, so anything that must be
 * reachable by other people or by the system browser — shared agent chat
 * links, OAuth callback pages — points at the web console instead.
 * Overridable per environment via `VITE_STIGMER_CONSOLE_URL`.
 */
export const CONSOLE_URL: string = (
  import.meta.env.VITE_STIGMER_CONSOLE_URL ?? "https://app.stigmer.ai"
).replace(/\/$/, "");
