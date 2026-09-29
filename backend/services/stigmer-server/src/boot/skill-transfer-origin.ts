/**
 * The skill transfer lane's origin: where its capability URLs point, and
 * whether the callers they are minted for can reach it.
 *
 * On the local blob driver the server itself carries artifact bytes over
 * HTTP, and every upload and download capability URL it mints is rendered
 * from one base. `SKILL_TRANSFER_BASE_URL` sets it; unset, it is the
 * server's own port on localhost, and this module is the one place that
 * says how. The rules, in order: a configured value always wins; a unified
 * port the composition knows renders `http://localhost:<port>` once; a
 * unified port of 0 (`GRPC_PORT=0`, and the `portOverride: 0` test seam)
 * is not known until listen, so the base reads the port the listener
 * actually bound. Deriving from the configured port instead minted URLs
 * for `localhost:0`, or for the config default under a port override,
 * where nothing listens (stigmer#1386). The unified port binds last in
 * start(), and every minting RPC arrives through it, so a read before the
 * bind is a construction-order fault and throws rather than minting a URL
 * for a port nothing listens on: the artifact lane's rule
 * (boot/artifact-lane.ts).
 *
 * The loopback default is right for a single-operator install reached on
 * the machine it runs on, and silently wrong for a hosted one: the server
 * boots, serves, and passes every in-process check while handing the CLI,
 * the SDKs and the sandbox runner a host none of them can reach — every
 * push above the gRPC cap fails on the PUT and every sandbox mount of a
 * skill with supporting files loses them (stigmer#1219). No test inside
 * the process can see it, so the process says it at boot. The verdict
 * judges the configuration, not a rendered URL: an unset base is loopback
 * by construction, whatever port it later reads.
 *
 * The hosted signal is the require-authentication posture (boot/compose.ts
 * combines its two sources): a server that requires credentials serves
 * callers it does not share a machine with. A bucket driver signs URLs
 * straight to its bucket and never renders the base URL, so the verdict
 * is moot there and says so rather than warning about a knob nothing
 * reads.
 *
 * Proven by __tests__/skill-transfer-origin.test.ts and the transfer lane
 * case of __tests__/compose.test.ts.
 */

export interface SkillTransferBaseUrlInputs {
  /** `SKILL_TRANSFER_BASE_URL` as loaded; empty when unset. */
  readonly configured: string;
  /** The port the unified listener binds; 0 means "not known until listen". */
  readonly unifiedPort: number;
  /** The port the unified listener actually bound; undefined before listen. */
  readonly boundPort: () => number | undefined;
}

/**
 * The base the lane's capability URLs are rendered from: the configured
 * value as given, the known unified port's loopback origin, or a resolver
 * over the port the unified listener bound.
 */
export function resolveSkillTransferBaseUrl(
  inputs: SkillTransferBaseUrlInputs,
): string | (() => string) {
  if (inputs.configured !== "") return inputs.configured;
  if (inputs.unifiedPort !== 0) return `http://localhost:${inputs.unifiedPort}`;
  const { boundPort } = inputs;
  return () => {
    const port = boundPort();
    if (port === undefined) {
      throw new Error(
        "skill transfer URL requested before the unified port bound",
      );
    }
    return `http://localhost:${port}`;
  };
}

/** What the boot warning names when the operator set no base. */
export const UNSET_BASE_URL_NOTE =
  "(unset: derived from the server's own port on localhost)";

/** Hosts that name the process's own machine and nothing beyond it. */
const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "0.0.0.0",
  "[::]",
]);

export type SkillTransferOriginVerdict =
  /** The configured base names a host other than the server's own loopback. */
  | { readonly kind: "reachable" }
  /** Loopback on a single-operator install: the default, and correct. */
  | { readonly kind: "loopback-local" }
  /** Loopback on a server that requires authentication: minted URLs are dead on arrival. */
  | { readonly kind: "loopback-hosted"; readonly baseUrl: string }
  /** The blob driver signs its own URLs; the base URL is never rendered. */
  | { readonly kind: "unused" };

export interface SkillTransferOriginInputs {
  /** `SKILL_TRANSFER_BASE_URL` as loaded; empty (the loopback default) when unset. */
  readonly configured: string;
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
  if (inputs.configured !== "" && !namesLoopback(inputs.configured)) {
    return { kind: "reachable" };
  }
  return inputs.requireAuthentication
    ? {
        kind: "loopback-hosted",
        baseUrl:
          inputs.configured === "" ? UNSET_BASE_URL_NOTE : inputs.configured,
      }
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
