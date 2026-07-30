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
 * Accepted limitation: a DNS-rebinding window remains between our lookup
 * and the socket connect — Node's fetch (undici) offers no lookup pinning
 * without replacing the dispatcher, and the strict posture's range blocks
 * make the rebinding payoff (an internal address) unreachable anyway.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type GuardPosture = "strict" | "relaxed";

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
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlGuardError(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlGuardError(
      `Unsupported URL scheme "${url.protocol.replace(/:$/, "")}" — only http and https are allowed.`,
    );
  }

  const addresses = await resolveAddresses(url.hostname);
  for (const address of addresses) {
    const reason = blockedReason(address, posture);
    if (reason) {
      throw new UrlGuardError(
        `Refusing to fetch ${url.hostname}: it resolves to ${address}, a ${reason} address that this runner does not fetch from.`,
      );
    }
  }

  return url;
}

/**
 * Resolve a hostname to all of its addresses. Literal IPs pass through
 * (bracketed IPv6 hosts arrive from URL.hostname still bracketed).
 */
async function resolveAddresses(hostname: string): Promise<string[]> {
  const literal = hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) !== 0) {
    return [literal];
  }

  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((r) => r.address);
  } catch {
    throw new UrlGuardError(`Could not resolve hostname: ${hostname}`);
  }
}

/**
 * Classify an IP address against the posture's blocked ranges.
 *
 * @returns a human-readable range name when blocked, or null when allowed.
 */
export function blockedReason(address: string, posture: GuardPosture): string | null {
  const family = isIP(address);

  if (family === 4) {
    return blockedReasonV4(address, posture);
  }

  if (family === 6) {
    const groups = expandV6(address);
    if (!groups) return "unrecognized";

    // IPv4-mapped IPv6 (::ffff:a.b.c.d, in dotted OR hex form) — classify
    // the embedded IPv4 so the mapping cannot smuggle a blocked v4 address
    // past the guard.
    const embedded = extractMappedV4(groups);
    if (embedded) {
      return blockedReasonV4(embedded, posture);
    }
    return blockedReasonV6(groups, posture);
  }

  // Unparseable — fail closed; only real addresses get sockets.
  return "unrecognized";
}

function blockedReasonV4(address: string, posture: GuardPosture): string | null {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
    return "unrecognized";
  }
  const [a, b] = octets;

  // Link-local (169.254.0.0/16) hosts the cloud metadata service at
  // 169.254.169.254 — blocked under BOTH postures.
  if (a === 169 && b === 254) return "link-local (cloud metadata)";

  if (posture === "relaxed") return null;

  if (a === 127) return "loopback";
  if (a === 0) return "unspecified";
  if (a === 10) return "private (RFC 1918)";
  if (a === 172 && b >= 16 && b <= 31) return "private (RFC 1918)";
  if (a === 192 && b === 168) return "private (RFC 1918)";

  return null;
}

function blockedReasonV6(groups: readonly number[], posture: GuardPosture): string | null {
  // fe80::/10 — IPv6 link-local, the v6 sibling of the metadata range;
  // blocked under BOTH postures for symmetry with v4.
  if ((groups[0] & 0xffc0) === 0xfe80) return "link-local (cloud metadata)";

  if (posture === "relaxed") return null;

  const allZero = groups.every((g) => g === 0);
  if (allZero) return "unspecified";
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return "loopback";
  // fc00::/7 — unique local (private) addresses.
  if ((groups[0] & 0xfe00) === 0xfc00) return "private (unique local)";

  return null;
}

/**
 * Expand an IPv6 address (already validated by isIP) into its 8 groups.
 * Handles `::` compression, a trailing dotted-IPv4 tail, and zone suffixes.
 */
function expandV6(address: string): number[] | null {
  let text = address.toLowerCase().split("%")[0];

  // Convert a dotted-IPv4 tail (e.g. ::ffff:127.0.0.1) into two hex groups.
  const v4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4Tail) {
    const octets = v4Tail[1].split(".").map(Number);
    if (octets.length !== 4 || octets.some((o) => o > 255)) return null;
    const hex = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    text = text.slice(0, -v4Tail[1].length) + hex;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const parseHalf = (half: string): number[] =>
    half === "" ? [] : half.split(":").map((g) => parseInt(g, 16));

  const head = parseHalf(halves[0]);
  const tail = halves.length === 2 ? parseHalf(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 0 : head.length !== 8) return null;

  const groups = [...head, ...(halves.length === 2 ? Array(fill).fill(0) : []), ...tail];
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) {
    return null;
  }
  return groups;
}

/** Extract the IPv4 payload from IPv4-mapped groups (::ffff:0:0/96), if any. */
function extractMappedV4(groups: readonly number[]): string | null {
  const isMapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (!isMapped) return null;
  const [hi, lo] = [groups[6], groups[7]];
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}
