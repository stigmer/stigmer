/**
 * How the runner reaches Temporal for its work: directly, or through the
 * Stigmer server.
 *
 * A sandboxed runner never holds Temporal's own address or credential. Its
 * driver hands it the Stigmer server's address as its Temporal address
 * (the server's `temporal-worker-door` lane, on the port every sandbox
 * already reaches), and the server admits it to its own task queue alone,
 * from its own credential. The runner tells the two apart by one derived
 * fact, never a setting of its own: the Temporal address equals the
 * backend endpoint's host and port. Then:
 *
 *   - the runner's control-plane token is its Temporal API key (the
 *     server reads it exactly as on every other call), and each renewed
 *     token reaches the connection (`NativeConnection.setApiKey`);
 *   - TLS follows the endpoint's scheme, stated explicitly: the SDK's API
 *     key path turns TLS on when it is left unset, which would break a
 *     cleartext `http://` endpoint;
 *   - the `STIGMER_TEMPORAL_*` settings, which configure a direct
 *     connection, must be absent: both at once is a contradiction the boot
 *     refuses with a sentence, as it refuses the server lane with no token;
 *   - the runner opens a fixed, small number of activity polls (the
 *     server holds at most twice this many for one sandbox) and sends no
 *     worker heartbeats, a call the server does not serve.
 *
 * A static runner (compose, Helm, `stigmer up`, the desktop) dials
 * Temporal directly with the `STIGMER_TEMPORAL_*` settings, unchanged: it
 * runs inside the server's own trust domain.
 */
import type { TemporalConnectionConfig } from "@stigmer/temporal-codecs";

/**
 * Activity polls a runner behind the server holds open at once. The
 * server's per-sandbox limit is twice this (`temporal-worker-door` in the
 * server, `HELD_POLLS_PER_SANDBOX`), so a poll replaced during a reconnect
 * is never refused.
 */
export const THROUGH_SERVER_ACTIVITY_POLLS = 2;

/** The connection options the runner's worker connection takes beyond its address. */
export interface TemporalLaneOptions {
  readonly apiKey?: string;
  readonly tls?: TemporalConnectionConfig["tls"] | boolean;
}

/** How the runner reaches Temporal. */
export type TemporalLane =
  | { readonly kind: "direct"; readonly connection: TemporalLaneOptions }
  | { readonly kind: "through-server"; readonly connection: TemporalLaneOptions };

export interface ResolveTemporalLaneInput {
  /** The resolved Temporal address (host:port). */
  readonly temporalAddress: string;
  /** The backend endpoint, normalized to carry its scheme. */
  readonly backendEndpoint: string;
  /** The control-plane credential, current at boot. */
  readonly token: string | null;
  /** The `STIGMER_TEMPORAL_*` settings, for a direct connection. */
  readonly directConnection: TemporalConnectionConfig;
}

/** Decides the lane (module header); throws one sentence on a contradiction. */
export function resolveTemporalLane(input: ResolveTemporalLaneInput): TemporalLane {
  const backend = hostPortOf(input.backendEndpoint);
  if (backend === undefined || backend.hostPort !== normalizeHostPort(input.temporalAddress)) {
    return { kind: "direct", connection: input.directConnection };
  }
  const token = input.token?.trim() ?? "";
  if (token === "") {
    throw new Error(
      `The runner's Temporal address is the Stigmer server's (${backend.hostPort}), which admits a runner by its token, and the runner has no STIGMER_TOKEN`,
    );
  }
  if (input.directConnection.apiKey !== undefined || input.directConnection.tls !== undefined) {
    throw new Error(
      `The runner's Temporal address is the Stigmer server's (${backend.hostPort}), and STIGMER_TEMPORAL_* settings are set for a direct Temporal connection; remove them, or give the runner Temporal's own address`,
    );
  }
  return {
    kind: "through-server",
    connection: { apiKey: token, tls: backend.secure },
  };
}

interface EndpointHostPort {
  readonly hostPort: string;
  readonly secure: boolean;
}

/** The host:port an endpoint URL names, its scheme's port filled in. */
function hostPortOf(endpoint: string): EndpointHostPort | undefined {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return undefined;
  }
  const secure = url.protocol === "https:";
  if (!secure && url.protocol !== "http:") {
    return undefined;
  }
  const port = url.port !== "" ? url.port : secure ? "443" : "80";
  return { hostPort: `${url.hostname.toLowerCase()}:${port}`, secure };
}

function normalizeHostPort(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Decides the lane at boot and, behind the server, turns the SDK's worker
 * heartbeats off: the server does not serve them. The SDK's runtime is
 * installed once per process and before any connection; an embedder that
 * installed its own keeps it, and the server answers the heartbeat as a
 * method it does not serve, which the SDK ignores.
 */
export async function bootTemporalLane(input: ResolveTemporalLaneInput): Promise<TemporalLane> {
  const lane = resolveTemporalLane(input);
  if (lane.kind === "through-server") {
    const { Runtime } = await import("@temporalio/worker");
    try {
      Runtime.install({ workerHeartbeatInterval: 0 });
    } catch (err) {
      console.warn(
        `[runner] Temporal runtime already installed; worker heartbeats stay on: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return lane;
}

/** The one connection method the key sink needs. */
interface ApiKeyConnection {
  setApiKey(apiKey: string): Promise<void>;
}

/**
 * Where a renewed token goes behind the server: the worker connection's
 * API key. The renewal starts before the connection exists, so a token
 * renewed before `attach` is held and handed over then; a direct lane
 * attaches nothing.
 */
export interface TemporalApiKeySink {
  readonly apply: (token: string) => void;
  attach(lane: TemporalLane, connection: ApiKeyConnection): void;
}

export function newTemporalApiKeySink(): TemporalApiKeySink {
  let connection: ApiKeyConnection | undefined;
  let pending: string | undefined;
  const send = (target: ApiKeyConnection, token: string): void => {
    target.setApiKey(token).catch((err: unknown) => {
      console.warn(
        `[runner] Could not hand the renewed token to the Temporal connection: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };
  return {
    apply: (token) => {
      if (connection === undefined) {
        pending = token;
        return;
      }
      send(connection, token);
    },
    attach(lane, target) {
      if (lane.kind !== "through-server") {
        return;
      }
      connection = target;
      if (pending !== undefined) {
        send(target, pending);
        pending = undefined;
      }
    },
  };
}
