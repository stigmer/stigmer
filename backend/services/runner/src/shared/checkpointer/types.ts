/**
 * Configuration for the checkpointer factory.
 *
 * Two backends are supported:
 * - memory: ephemeral in-process storage (OSS / local development)
 * - http: routes through the Stigmer Side-Channel Proxy (cloud)
 */
export interface CheckpointerConfig {
  readonly type: "memory" | "http";
  readonly proxyEndpoint?: string;
  readonly authToken?: string;
}
