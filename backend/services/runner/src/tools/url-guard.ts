/**
 * URL guard for the native `web_fetch` tool — the SSRF boundary.
 *
 * Why this is load-bearing: `web_fetch` is deliberately auto-approved (see
 * shared/tool-kind.ts `toolApprovalCategory`), so in unattended runs it is
 * the only ungated network path an agent has. On managed cloud runners the
 * fetch executes inside the runner process, which sits on infrastructure
 * with network reach to internal services and the cloud metadata endpoint —
 * without this guard, "fetch a URL" becomes "read my pod's credentials".
 *
 * The address rule itself (which ranges each posture refuses, how an
 * IPv4-mapped IPv6 is unwrapped, how every resolved address is judged) has
 * one home, `@stigmer/outbound/egress`, shared with the control plane, which
 * dials user-supplied URLs too. This module keeps what is the runner's:
 * deriving the posture from its mode, and the sentence a model reads.
 *
 * Posture is mode-aware because locality differs, not trust:
 *
 * - "strict" (managed cloud runners): loopback, RFC 1918 private,
 *   link-local, and their IPv6 equivalents are all rejected.
 * - "relaxed" (self-hosted / local runners): the machine belongs to the
 *   user, and fetching their own dev server (http://localhost:3000) is a
 *   legitimate ask — only the link-local range (which contains the cloud
 *   metadata endpoint 169.254.169.254) stays blocked, as costless
 *   defense-in-depth.
 *
 * The default posture derives from Config.mode ("cloud" → strict), NOT from
 * cloudModeEnabled — that is the Cursor cloud-agent feature flag and says
 * nothing about where this process runs. Config.mode tracks credential
 * transport rather than physical locality (a desktop runner proxies traffic
 * while executing on the user's machine), so STIGMER_WEB_FETCH_ALLOW_PRIVATE
 * exists as an explicit override for embedders that know better. Managed
 * cloud deployments never set it.
 *
 * Validation runs on the addresses DNS resolves to immediately before the
 * request is dispatched, and the caller re-validates every redirect hop.
 * The accepted DNS-rebinding limitation is stated in the shared check's
 * header.
 */
import {
  checkEgress,
  egressPolicyForPosture,
  nodeLookup,
  blockedReason as sharedBlockedReason,
  type EgressPosture,
} from "@stigmer/outbound/egress";

export type GuardPosture = EgressPosture;

/** Thrown for every guard rejection; message is safe to surface to the model. */
export class UrlGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlGuardError";
  }
}

/**
 * Derive the guard posture from runner mode plus the explicit override.
 *
 * @param mode Config.mode — "cloud" means a managed runner on shared infrastructure.
 * @param env  Environment to read STIGMER_WEB_FETCH_ALLOW_PRIVATE from.
 */
export function resolveGuardPosture(
  mode: "local" | "cloud",
  env: NodeJS.ProcessEnv = process.env,
): GuardPosture {
  const override = env.STIGMER_WEB_FETCH_ALLOW_PRIVATE;
  if (override === "true") return "relaxed";
  if (override === "false") return "strict";
  return mode === "cloud" ? "strict" : "relaxed";
}

const lookup = nodeLookup();

/**
 * Validate a URL for fetching under the given posture.
 *
 * Checks the scheme, then resolves the hostname and checks EVERY address it
 * resolves to (a hostname with one public and one private A record must be
 * rejected, or the private record becomes the bypass).
 *
 * @returns the parsed URL on success.
 * @throws UrlGuardError with a model-readable reason on rejection.
 */
export async function validateFetchUrl(
  rawUrl: string,
  posture: GuardPosture,
): Promise<URL> {
  const check = await checkEgress(rawUrl, egressPolicyForPosture(posture), { lookup });
  if (check.ok) return check.url;

  const refusal = check.refusal;
  switch (refusal.kind) {
    case "invalid-url":
      throw new UrlGuardError(`Invalid URL: ${refusal.url}`);
    case "unsupported-scheme":
      throw new UrlGuardError(
        `Unsupported URL scheme "${refusal.scheme}" — only http and https are allowed.`,
      );
    case "unresolvable":
      throw new UrlGuardError(`Could not resolve hostname: ${refusal.hostname}`);
    case "blocked":
      throw new UrlGuardError(
        `Refusing to fetch ${refusal.hostname}: it resolves to ${refusal.address}, a ${refusal.reason} address that this runner does not fetch from.`,
      );
    case "too-many-redirects":
      // The check itself never follows a redirect; web_fetch walks hops
      // one validateFetchUrl at a time, so this refusal cannot arise here.
      throw new UrlGuardError(`Refusing to follow more than ${refusal.hops} redirects.`);
    default: {
      const exhaustive: never = refusal;
      throw new UrlGuardError(String(exhaustive));
    }
  }
}

/**
 * Classify an IP address against the posture's blocked ranges.
 *
 * @returns a human-readable range name when blocked, or null when allowed.
 */
export function blockedReason(address: string, posture: GuardPosture): string | null {
  return sharedBlockedReason(address, posture);
}
