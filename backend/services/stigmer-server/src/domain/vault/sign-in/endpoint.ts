/**
 * The one rule for a login server's endpoints: https, or plain http only on
 * the loopback interface (`localhost`, `127.0.0.1`, `[::1]`), where a login
 * server on the same machine runs in development and the suites. A
 * person's browser is sent to the authorization endpoint, so any other
 * scheme (`javascript:`, `data:`) would run in the console's origin; the
 * token, registration and user-info endpoints receive a code, a secret or
 * a token, which never travel in the clear off the machine.
 *
 * Read by discovery (a login server's own metadata), by the app path of a
 * sign-in (an organization's app or a catalog entry), and by the OAuthApp
 * save, so an app that could never sign in is refused when it is written.
 *
 * Proven by __tests__/endpoint.test.ts.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Why `value` cannot be a login endpoint, or undefined when it can. */
export function loginEndpointProblem(value: string): string | undefined {
  if (!URL.canParse(value)) return "is not an absolute URL";
  const url = new URL(value);
  if (url.protocol === "https:") return undefined;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return undefined;
  return "must be an https URL (http only for localhost, 127.0.0.1 or [::1])";
}
