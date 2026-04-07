// ---------------------------------------------------------------------------
// SSO session management — sessionStorage helpers
//
// Two distinct keys manage the SSO lifecycle:
//
// 1. `stigmer:sso:login` — ephemeral. Written on the login page before
//    redirecting to the SSO IdP. Read by OidcAuthProvider on /auth/callback
//    to create the correct UserManager for code exchange. Cleared
//    immediately after the callback is processed.
//
// 2. `stigmer:sso:session` — persistent (for the tab lifetime). Written
//    after a successful SSO callback. Read on every page load so
//    OidcAuthProvider creates an SSO UserManager (instead of Auth0) for
//    session restore and token renewal. Cleared on logout.
//
// Both keys store the same shape (SsoState) but serve different purposes
// in the SSO flow timeline.
// ---------------------------------------------------------------------------

const LOGIN_STATE_KEY = "stigmer:sso:login";
const SESSION_KEY = "stigmer:sso:session";

/**
 * SSO OIDC configuration needed to create a UserManager.
 *
 * Stored in sessionStorage at two points in the SSO flow:
 * pre-redirect (login state) and post-callback (session state).
 */
export interface SsoState {
  readonly issuer: string;
  readonly clientId: string;
  readonly audience: string;
  readonly org: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Type guard that validates a parsed value is a well-formed SsoState. */
export function isValidSsoState(value: unknown): value is SsoState {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.issuer === "string" &&
    obj.issuer.length > 0 &&
    typeof obj.clientId === "string" &&
    obj.clientId.length > 0 &&
    typeof obj.audience === "string" &&
    typeof obj.org === "string" &&
    obj.org.length > 0
  );
}

// ---------------------------------------------------------------------------
// Login state — ephemeral, pre-callback
// ---------------------------------------------------------------------------

export function saveSsoLoginState(state: SsoState): void {
  sessionStorage.setItem(LOGIN_STATE_KEY, JSON.stringify(state));
}

export function getSsoLoginState(): SsoState | null {
  return readAndValidate(LOGIN_STATE_KEY);
}

export function clearSsoLoginState(): void {
  sessionStorage.removeItem(LOGIN_STATE_KEY);
}

// ---------------------------------------------------------------------------
// Session state — persistent across page reloads
// ---------------------------------------------------------------------------

export function saveSsoSession(state: SsoState): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
}

export function getSsoSession(): SsoState | null {
  return readAndValidate(SESSION_KEY);
}

export function clearSsoSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function readAndValidate(key: string): SsoState | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidSsoState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
