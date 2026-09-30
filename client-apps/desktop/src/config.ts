import type { DeploymentMode } from "@stigmer/sdk";

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

/**
 * The Stigmer API this build talks to. Overridable per environment via
 * `VITE_STIGMER_API_URL`; a build that sets none talks to a local server.
 */
export const API_URL: string =
  import.meta.env.VITE_STIGMER_API_URL ?? "http://localhost:7234";

/**
 * The host of an API URL, or null when it is not a usable one. `new URL`
 * alone is too lenient: it reads `api.stigmer.ai:443` as a URL whose scheme
 * is `api.stigmer.ai:` and whose host is empty.
 */
function apiHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    const web = parsed.protocol === "http:" || parsed.protocol === "https:";
    return web && parsed.hostname !== "" ? parsed.hostname : null;
  } catch {
    return null;
  }
}

/** Whether an API URL is a usable http(s) URL; the sign-in screen names one that is not. */
export function isValidApiUrl(url: string): boolean {
  return apiHostname(url) !== null;
}

/** Whether an API URL names this machine. A URL that is not usable does not. */
export function isLocalApiUrl(url: string): boolean {
  const hostname = apiHostname(url);
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/**
 * The deployment mode to assume until the server answers `getServerInfo`:
 * a local server for a local URL, the cloud otherwise. A URL that does not
 * parse reaches no server at all, so the guess stays the harmless one.
 */
export function fallbackDeploymentMode(url: string): DeploymentMode {
  if (!isValidApiUrl(url)) return "local";
  return isLocalApiUrl(url) ? "local" : "cloud";
}

/**
 * Whether the app runs with auth disabled: only against a local server, and
 * never when the build forces sign-in. A URL that is not usable fails
 * closed, onto the sign-in screen, which says what is wrong with it; it
 * must not silently turn sign-in off.
 */
export function isAuthDisabled(url: string, forceAuth: boolean): boolean {
  if (forceAuth) return false;
  return isLocalApiUrl(url);
}
