/**
 * Keeps a server without sign-in on the machine it runs on.
 *
 * With no identity verifier required, every request without a token is the
 * operator (pipeline/interceptors/auth.ts): the right posture for one
 * person on their own machine, and only for them. Three doors would let
 * someone else in, and this module and the bind default close them
 * (stigmer#2945):
 *
 *   - the network: the unified port binds loopback by default when sign-in
 *     is off (boot/compose.ts); a container image opts in to every
 *     interface (GRPC_HOST, as ARTIFACT_HTTP_HOST already does);
 *   - another web site, through the operator's own browser: a request that
 *     carries an `Origin` other than this machine's is refused. A browser
 *     sends `Origin` on every cross-site request, the `text/plain` POST
 *     that needs no preflight included, so refusing it is what stops the
 *     request, where CORS headers would only hide the answer. The CLI, the
 *     runner, the SDKs and curl send no `Origin` and are unaffected;
 *   - DNS rebinding: a page whose own name resolves to 127.0.0.1 reaches
 *     the loopback listener as the same origin, so the `Host` it sends is
 *     its own name. A request that arrived on a loopback address must name
 *     a loopback host.
 *
 * "This machine's" origins: http and https on a loopback name, and the
 * desktop app's webview (`tauri://localhost`, and `tauri.localhost` where
 * the webview serves it over http). A request that arrived on another
 * interface (a container's own network, where the image opted in) keeps
 * the Origin rule; its Host is whatever name the network gives it.
 */
import type { LaneRequest } from "./lanes.js";

/** The loopback names a Host or an Origin may carry. */
const LOOPBACK_NAMES: ReadonlySet<string> = new Set(["localhost", "::1"]);

/** Whether `hostname` (no port, no brackets) names this machine. */
export function isLoopbackHostname(hostname: string): boolean {
  const name = hostname.toLowerCase();
  return (
    LOOPBACK_NAMES.has(name) ||
    name.endsWith(".localhost") ||
    /^127(\.\d{1,3}){3}$/.test(name) ||
    name === "::ffff:127.0.0.1"
  );
}

/** The hostname of a Host header or an :authority (`name:port`, `[v6]:port`). */
export function hostnameOf(authority: string): string {
  const value = authority.trim();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end < 0 ? value : value.slice(1, end);
  }
  const colon = value.lastIndexOf(":");
  return colon < 0 ? value : value.slice(0, colon);
}

/** Whether `origin` is a page on this machine or the desktop app's webview. */
export function isLocalOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === "tauri:") {
    return true;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  return isLoopbackHostname(hostname) || hostname === "tauri.localhost";
}

/** The refusals, by door; the request is answered 403 with the sentence. */
export const FOREIGN_ORIGIN_REFUSED =
  "this server has no sign-in, so it answers only pages on its own machine; configure sign-in to serve other origins";
export const FOREIGN_HOST_REFUSED =
  "this server has no sign-in and listens on this machine only; the request named another host";

/**
 * Why a request must be refused on a server without sign-in, or undefined
 * when it may go on.
 */
export function localOnlyRefusal(request: LaneRequest): string | undefined {
  const origin = request.headers["origin"];
  if (typeof origin === "string" && !isLocalOrigin(origin)) {
    return FOREIGN_ORIGIN_REFUSED;
  }
  const arrivedOn = request.socket.localAddress;
  if (arrivedOn !== undefined && isLoopbackHostname(arrivedOn)) {
    const authority = request.headers[":authority"] ?? request.headers.host;
    if (typeof authority === "string" && !isLoopbackHostname(hostnameOf(authority))) {
      return FOREIGN_HOST_REFUSED;
    }
  }
  return undefined;
}
