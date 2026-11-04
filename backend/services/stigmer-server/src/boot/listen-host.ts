/**
 * The unified port's bind host. An operator's choice wins (the compose
 * option a test or an embedder passes, then GRPC_HOST); otherwise the
 * sign-in posture decides. A server that signs its callers in listens on
 * every interface, as it always has. A server without sign-in treats every
 * tokenless request as its operator, so by default it listens on loopback
 * only, and the network cannot reach it (stigmer#2945). The official
 * container images set GRPC_HOST=0.0.0.0, because a loopback bind is
 * unreachable through the container boundary; the compose file publishes
 * the port on the host's loopback.
 *
 * One more fact decides the default: a server whose operator configured a
 * container sandbox driver has named, in STIGMER_SANDBOX_BACKEND_ENDPOINT,
 * the address its sandboxes dial it at. When that address is not a
 * loopback one, the server listens on every interface by default, because
 * that is where its sandboxes come from, and says so at boot when it signs
 * nobody in.
 *
 * An operator who chooses a wider bind without sign-in is told, once at
 * boot, what that exposes; the transport still refuses other sites and
 * rebinding names (transport/local-only.ts).
 */

/** The default bind of a server without sign-in. */
export const LOOPBACK_LISTEN_HOST = "127.0.0.1";
/** The default bind of a server that signs its callers in. */
export const ALL_INTERFACES_LISTEN_HOST = "0.0.0.0";

export interface ListenHostChoice {
  readonly host: string;
  /** Set when a server without sign-in was told to listen beyond loopback. */
  readonly warning?: string;
}

export function chooseListenHost(input: {
  readonly chosen: string | undefined;
  readonly requireAuthentication: boolean;
  /** The address the sandboxes dial (STIGMER_SANDBOX_BACKEND_ENDPOINT), "" when no container driver names one. */
  readonly sandboxEndpoint: string;
}): ListenHostChoice {
  const host =
    input.chosen ??
    (input.requireAuthentication || sandboxesDialIn(input.sandboxEndpoint)
      ? ALL_INTERFACES_LISTEN_HOST
      : LOOPBACK_LISTEN_HOST);
  if (input.requireAuthentication || isLoopbackListenHost(host)) {
    return { host };
  }
  return {
    host,
    warning: `listening on ${host} without sign-in: anyone who can reach this address acts as the operator; configure sign-in (STIGMER_OIDC_ISSUER) before serving a network`,
  };
}

function isLoopbackListenHost(host: string): boolean {
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

/** Whether a configured sandbox endpoint names an address beyond loopback, so sandboxes dial in over the network. */
function sandboxesDialIn(endpoint: string): boolean {
  if (endpoint === "") {
    return false;
  }
  let hostname: string;
  try {
    hostname = new URL(endpoint.includes("://") ? endpoint : `http://${endpoint}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return true;
  }
  return !isLoopbackListenHost(hostname);
}
