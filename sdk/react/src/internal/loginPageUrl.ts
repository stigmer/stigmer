/**
 * The check every sign-in makes before it sends a browser to an address a
 * server answered (a login page, a Connect link's return URL): the address
 * must be https, or http on the loopback interface (a server on the same
 * machine in development). The server refuses any other address already;
 * this second lock keeps a script URL (`javascript:`, `data:`) from ever
 * running in the console's origin, whatever answered.
 *
 * Not exported from the public barrel.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** What a person reads when a login page's address fails the check. */
export const UNSAFE_LOGIN_PAGE_MESSAGE =
  "The login page's address is not an https address, so the sign-in was stopped.";

/**
 * Answers `value` when a browser may be sent there, and throws
 * {@link UNSAFE_LOGIN_PAGE_MESSAGE} otherwise.
 *
 * @internal
 */
export function checkedLoginPageUrl(value: string): string {
  if (isBrowserDestination(value)) return value;
  throw new Error(UNSAFE_LOGIN_PAGE_MESSAGE);
}

/**
 * Whether a browser may be sent to `value`: https, or http on the loopback
 * interface.
 *
 * @internal
 */
export function isBrowserDestination(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
}
