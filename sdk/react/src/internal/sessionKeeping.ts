/**
 * Whether this tab may keep a value in session storage, asked before a
 * sign-in starts that needs one kept across the login page (a Connect
 * link's secret, a desktop shell's sign-in state). A browser that refuses
 * site data throws on the write; asking first means no sign-in is started
 * that could never be finished, and the person reads what to change.
 *
 * Not exported from the public barrel.
 */

/** What a person reads when the browser refuses to keep the sign-in. */
export const SESSION_REFUSED_MESSAGE =
  "This browser does not let the page remember the sign-in it starts. Allow this site to store data, then try again.";

const PROBE_KEY = "stigmer:session-probe";

/**
 * Whether session storage takes a write in this tab.
 *
 * @internal
 */
export function canKeepInSession(): boolean {
  try {
    sessionStorage.setItem(PROBE_KEY, "1");
    sessionStorage.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}
