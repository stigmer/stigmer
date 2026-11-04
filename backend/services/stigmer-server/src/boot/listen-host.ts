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
}): ListenHostChoice {
  if (input.chosen === undefined) {
    return {
      host: input.requireAuthentication
        ? ALL_INTERFACES_LISTEN_HOST
        : LOOPBACK_LISTEN_HOST,
    };
  }
  const loopback =
    input.chosen === "localhost" ||
    input.chosen === "::1" ||
    input.chosen.startsWith("127.");
  if (input.requireAuthentication || loopback) {
    return { host: input.chosen };
  }
  return {
    host: input.chosen,
    warning: `listening on ${input.chosen} without sign-in: anyone who can reach this address acts as the operator; configure sign-in (STIGMER_OIDC_ISSUER) before serving a network`,
  };
}
