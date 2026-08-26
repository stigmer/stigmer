/**
 * Authorization-endpoint pre-flight probe — ports
 * pkg/domain/mcpserver/oauth/preflight.go.
 *
 * Some providers (e.g. Canva) accept Dynamic Client Registration for any
 * redirect URI but enforce a redirect-host allowlist at the authorization
 * endpoint. The rejection then surfaces only inside the OAuth popup, on a
 * vendor error page that never redirects back — so the connect flow never
 * learns it failed (stigmer/stigmer#235). This probe moves that discovery
 * to initiate time, where it can fail fast with an honest error.
 *
 * Classification is deliberately narrow — blocked means HTTP 400, nothing
 * else. RFC 6749 §4.1.2.1 requires an invalid-redirect rejection to be
 * shown at the authorization server without redirecting, which providers
 * implement as a 400. Everything else fails open (undefined, possibly
 * after a diagnostic error): bot-protection layers answer server-side
 * GETs with 403/503 while real browsers pass, and treating those as
 * blocked would turn healthy providers into false dead ends. A fail-open
 * miss merely preserves today's behavior; a false positive would break a
 * working connect flow.
 *
 * The probe is side-effect-free: state and PKCE parameters are opaque to
 * the authorization server at this point, and nothing is consumed until
 * the callback leg, which the probe never reaches.
 */
import { truncateBody } from "./truncate-body.js";

/**
 * A definite refusal from an authorization endpoint, observed before any
 * browser was involved (Go AuthorizeRejection).
 */
export interface AuthorizeRejection {
  /** The HTTP status the authorization endpoint returned. */
  statusCode: number;
  /**
   * The provider's own explanation, extracted from an RFC 6749-shaped
   * JSON error body (error_description, falling back to error). Empty
   * when the body is HTML or otherwise unparseable.
   */
  vendorDetail: string;
  /** A truncated copy of the raw response body, for logs. */
  bodySnippet: string;
}

/**
 * Go's preflightHTTPClient 4s timeout: this probe sits on the user-facing
 * initiate path, after discovery and DCR round trips.
 */
export const PREFLIGHT_REQUEST_TIMEOUT_MS = 4_000;

/**
 * Error pages are small; anything longer is noise (Go's LimitReader cap).
 */
const PREFLIGHT_BODY_READ_CAP = 4096;

/**
 * Probes an authorization URL server-side and reports whether the
 * provider will refuse it before ever showing a login page (Go
 * PreflightAuthorize). Redirects are deliberately not followed: a healthy
 * authorization endpoint answers a fresh GET with either a login/consent
 * page (2xx) or a redirect into the vendor's login flow (3xx), and the
 * first response alone is enough to classify.
 */
export async function preflightAuthorize(
  authorizationUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthorizeRejection | undefined> {
  // Network errors propagate to the caller, who treats them as
  // fail-open diagnostics — exactly Go's (nil, err) contract.
  const response = await fetchImpl(authorizationUrl, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(PREFLIGHT_REQUEST_TIMEOUT_MS),
  });

  if (response.status !== 400) {
    // Drain so the socket is reusable; the status alone classifies.
    await response.text().catch(() => "");
    return undefined;
  }

  const body = (await response.text()).slice(0, PREFLIGHT_BODY_READ_CAP);

  return {
    statusCode: response.status,
    vendorDetail: extractVendorDetail(body),
    bodySnippet: truncateBody(body),
  };
}

/**
 * Pulls the provider's own words from an RFC 6749-shaped JSON error body
 * (Go extractVendorDetail). HTML error pages (Canva's case) yield "" —
 * scraping prose out of markup is not worth the fragility.
 */
function extractVendorDetail(body: string): string {
  let parsed: { error?: string; error_description?: string };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    return "";
  }
  if ((parsed.error_description ?? "") !== "") {
    return parsed.error_description as string;
  }
  return parsed.error ?? "";
}
