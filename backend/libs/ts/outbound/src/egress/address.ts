/**
 * Address classification for outbound egress: which IP addresses a Stigmer
 * process refuses to dial, under which posture, and why.
 *
 * This is the one home of the rule. It began as the runner's `web_fetch`
 * SSRF boundary (backend/services/runner/src/tools/url-guard.ts, which now
 * delegates here) and is shared because the control plane dials
 * user-supplied URLs too: an MCP endpoint at save time and its login server
 * on Sign in. A rule with two copies drifts; a copy that drifted on the
 * control plane would be the copy guarding the wider network.
 *
 * Two postures, because locality differs, not trust:
 *
 * - "strict" (managed cloud processes): loopback, RFC 1918 private,
 *   link-local, unspecified, and their IPv6 equivalents are all refused.
 * - "relaxed" (self-hosted and local processes): the machine belongs to
 *   the user, and a server beside the process (http://localhost:3000/mcp,
 *   the proto's own example) is the normal case. Only the link-local range,
 *   which carries the cloud metadata endpoint 169.254.169.254, stays
 *   refused, as costless defence in depth.
 *
 * Who chooses the posture is the caller's business: the runner keys it on
 * its mode with an operator override; the control plane takes it from an
 * edition driver point. This module knows addresses and nothing else.
 *
 * IPv4-mapped IPv6 (::ffff:a.b.c.d in dotted or hex form) is classified by
 * the embedded IPv4, so the mapping cannot smuggle a refused address past
 * the check. Anything that is not a well-formed address fails closed.
 *
 * Proven by __tests__/address.test.ts, the runner's classification cases
 * moved here byte for byte.
 */
import { isIP } from "node:net";

/** The two egress postures; the caller derives one from where it runs. */
export type EgressPosture = "strict" | "relaxed";

/**
 * An egress policy: the synchronous address judgement a process dials
 * under. `blockedReason` answers for every string (an unparseable one is
 * refused as "unrecognized"), never throws, and does no I/O. A policy that
 * would need a network or a hostname to answer is a different seam.
 */
export interface EgressPolicy {
  /** The posture's name, for logs and error copy. */
  readonly name: string;
  /** A human-readable range name when the address is refused, null when allowed. */
  blockedReason(address: string): string | null;
}

/** The policy for a posture: the two shapes every consumer composes. */
export function egressPolicyForPosture(posture: EgressPosture): EgressPolicy {
  return {
    name: posture,
    blockedReason: (address) => blockedReason(address, posture),
  };
}

/**
 * Classify an IP address against the posture's refused ranges.
 *
 * @returns a human-readable range name when refused, or null when allowed.
 */
export function blockedReason(address: string, posture: EgressPosture): string | null {
  const family = isIP(address);

  if (family === 4) {
    return blockedReasonV4(address, posture);
  }

  if (family === 6) {
    const groups = expandV6(address);
    if (!groups) return "unrecognized";

    const embedded = extractMappedV4(groups);
    if (embedded) {
      return blockedReasonV4(embedded, posture);
    }
    return blockedReasonV6(groups, posture);
  }

  // Unparseable: fail closed; only real addresses get sockets.
  return "unrecognized";
}

function blockedReasonV4(address: string, posture: EgressPosture): string | null {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
    return "unrecognized";
  }
  const a = octets[0];
  const b = octets[1];

  // Link-local (169.254.0.0/16) hosts the cloud metadata service at
  // 169.254.169.254: refused under BOTH postures.
  if (a === 169 && b === 254) return "link-local (cloud metadata)";

  if (posture === "relaxed") return null;

  if (a === 127) return "loopback";
  if (a === 0) return "unspecified";
  if (a === 10) return "private (RFC 1918)";
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return "private (RFC 1918)";
  if (a === 192 && b === 168) return "private (RFC 1918)";

  return null;
}

function blockedReasonV6(groups: readonly number[], posture: EgressPosture): string | null {
  const first = groups[0] ?? 0;
  // fe80::/10, the IPv6 link-local range, the v6 sibling of the metadata
  // range: refused under BOTH postures for symmetry with v4.
  if ((first & 0xffc0) === 0xfe80) return "link-local (cloud metadata)";

  if (posture === "relaxed") return null;

  const allZero = groups.every((g) => g === 0);
  if (allZero) return "unspecified";
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return "loopback";
  // fc00::/7: unique local (private) addresses.
  if ((first & 0xfe00) === 0xfc00) return "private (unique local)";

  return null;
}

/**
 * Expand an IPv6 address (already validated by isIP) into its 8 groups.
 * Handles `::` compression, a trailing dotted-IPv4 tail, and zone suffixes.
 */
function expandV6(address: string): number[] | null {
  let text = address.toLowerCase().split("%")[0] ?? "";

  // Convert a dotted-IPv4 tail (for example ::ffff:127.0.0.1) into two hex groups.
  const v4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  const tail4 = v4Tail?.[1];
  if (tail4 !== undefined) {
    const octets = tail4.split(".").map(Number);
    if (octets.length !== 4 || octets.some((o) => o > 255)) return null;
    const [o0 = 0, o1 = 0, o2 = 0, o3 = 0] = octets;
    const hex = `${((o0 << 8) | o1).toString(16)}:${((o2 << 8) | o3).toString(16)}`;
    text = text.slice(0, -tail4.length) + hex;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const parseHalf = (half: string): number[] => (half === "" ? [] : half.split(":").map((g) => parseInt(g, 16)));

  const head = parseHalf(halves[0] ?? "");
  const tail = halves.length === 2 ? parseHalf(halves[1] ?? "") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 0 : head.length !== 8) return null;

  const groups = [...head, ...(halves.length === 2 ? Array<number>(fill).fill(0) : []), ...tail];
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) {
    return null;
  }
  return groups;
}

/** Extract the IPv4 payload from IPv4-mapped groups (::ffff:0:0/96), if any. */
function extractMappedV4(groups: readonly number[]): string | null {
  const isMapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (!isMapped) return null;
  const hi = groups[6] ?? 0;
  const lo = groups[7] ?? 0;
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}
