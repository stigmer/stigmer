/**
 * Whether the skill transfer lane's origin can be reached by the callers
 * it is minted for.
 *
 * On the local blob driver the server itself carries artifact bytes over
 * HTTP, and every upload and download capability URL it mints is rendered
 * from `SKILL_TRANSFER_BASE_URL`, which defaults to the server's own
 * loopback. That default is right for a single-operator install reached
 * on the machine it runs on, and silently wrong for a hosted one: the
 * server boots, serves, and passes every in-process check while handing
 * the CLI, the SDKs and the sandbox runner a host none of them can reach —
 * every push above the gRPC cap fails on the PUT and every sandbox mount
 * of a skill with supporting files loses them (stigmer#1219). No test
 * inside the process can see it, so the process says it at boot.
 *
 * The hosted signal is the require-authentication posture (boot/compose.ts
 * combines its two sources): a server that requires credentials serves
 * callers it does not share a machine with. A bucket driver signs URLs
 * straight to its bucket and never renders the base URL, so the verdict
 * is moot there and says so rather than warning about a knob nothing
 * reads.
 *
 * Proven by __tests__/skill-transfer-origin.test.ts.
 */

/** Hosts that name the process's own machine and nothing beyond it. */
const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "0.0.0.0",
  "[::]",
]);

export type SkillTransferOriginVerdict =
  /** The base URL names a host other than the server's own loopback. */
  | { readonly kind: "reachable" }
  /** Loopback on a single-operator install: the default, and correct. */
  | { readonly kind: "loopback-local" }
  /** Loopback on a server that requires authentication: minted URLs are dead on arrival. */
  | { readonly kind: "loopback-hosted"; readonly baseUrl: string }
  /** The blob driver signs its own URLs; the base URL is never rendered. */
  | { readonly kind: "unused" };

export interface SkillTransferOriginInputs {
  /** The configured or defaulted `SKILL_TRANSFER_BASE_URL`. */
  readonly baseUrl: string;
  /** Whether the local driver relays artifact bytes through this server. */
  readonly relaysThroughServer: boolean;
  /** The composed require-authentication posture. */
  readonly requireAuthentication: boolean;
}

export function assessSkillTransferOrigin(
  inputs: SkillTransferOriginInputs,
): SkillTransferOriginVerdict {
  if (!inputs.relaysThroughServer) {
    return { kind: "unused" };
  }
  if (!namesLoopback(inputs.baseUrl)) {
    return { kind: "reachable" };
  }
  return inputs.requireAuthentication
    ? { kind: "loopback-hosted", baseUrl: inputs.baseUrl }
    : { kind: "loopback-local" };
}

function namesLoopback(baseUrl: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(baseUrl).hostname);
  } catch {
    // An unparseable base URL renders into every capability URL as-is; it
    // is not loopback, and the failure it causes is loud on the first mint.
    return false;
  }
}
