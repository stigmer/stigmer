/**
 * The check every sign-in makes before it sends a browser to a login page:
 * the address must be https, or http on the loopback interface (a login
 * server on the same machine in development). The server refuses any other
 * login endpoint already; this second lock keeps a script URL (`javascript:`,
 * `data:`) from ever running in the console's origin, whatever answered.
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
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(UNSAFE_LOGIN_PAGE_MESSAGE);
  }
  if (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    return value;
  }
  throw new Error(UNSAFE_LOGIN_PAGE_MESSAGE);
}
