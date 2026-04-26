import type { Transport } from "@connectrpc/connect";

/**
 * Token provider callback for dynamic authentication.
 * Called per-request, allowing token refresh and auth state changes.
 * Return `null` to skip authentication for that request.
 */
export type TokenProvider = () => Promise<string | null> | string | null;

/**
 * Configuration for the Stigmer SDK client.
 *
 * Authentication: exactly one of `apiKey` or `getAccessToken` must be
 * provided (unless `customTransport` handles auth independently).
 *
 * Transport: by default the SDK creates a browser-oriented transport
 * using `@connectrpc/connect-web`. Pass `customTransport` to use a
 * pre-built transport — for example, `@connectrpc/connect-node` for
 * server-side or CLI usage.
 */
export interface StigmerConfig {
  /** Base URL of the Stigmer API server (e.g., "https://api.stigmer.ai"). */
  readonly baseUrl: string;

  /** Static API key. Sent as `Authorization: Bearer <apiKey>` on every request. */
  readonly apiKey?: string;

  /** Dynamic token provider. Called per-request to obtain a Bearer token. */
  readonly getAccessToken?: TokenProvider;

  /**
   * Called when the server returns UNAUTHENTICATED (code 16).
   * Typically used to clear auth state and redirect to login.
   * Invoked at most once per client instance to prevent cascading redirects.
   */
  readonly onUnauthenticated?: () => void;

  /**
   * Transport protocol to use for API communication.
   * - `"grpc-web"` (default): gRPC-Web binary protocol. Compact, battle-tested.
   * - `"connect"`: Connect protocol over HTTP/JSON. Easier to debug with standard HTTP tooling.
   *
   * Both protocols are supported by the Stigmer server. Ignored when
   * `customTransport` is provided.
   */
  readonly transport?: "grpc-web" | "connect";

  /**
   * Custom `fetch` implementation for the HTTP transport.
   *
   * By default the SDK uses the global `fetch` provided by the browser
   * or Node.js runtime. In environments where the global `fetch` is
   * restricted (e.g., Tauri/Electron webviews that face CORS limitations),
   * pass an alternative `fetch` that bypasses those restrictions.
   *
   * The Tauri HTTP plugin (`@tauri-apps/plugin-http`) exports a
   * compatible `fetch` that routes requests through the native Rust
   * HTTP client, avoiding browser CORS enforcement entirely.
   *
   * Ignored when `customTransport` is provided.
   *
   * @example
   * ```typescript
   * import { fetch } from "@tauri-apps/plugin-http";
   * import { Stigmer } from "@stigmer/sdk";
   *
   * const stigmer = new Stigmer({
   *   baseUrl: "https://api.stigmer.ai",
   *   getAccessToken: () => token,
   *   fetch,
   * });
   * ```
   */
  readonly fetch?: typeof globalThis.fetch;

  /**
   * Pre-built ConnectRPC transport.
   *
   * When provided, the SDK uses this transport directly instead of
   * creating one from `baseUrl`, `transport`, and the auth fields.
   * This enables non-browser environments (Node.js CLIs, edge runtimes)
   * to supply a transport with native HTTP/2 support via
   * `@connectrpc/connect-node` or any other ConnectRPC transport.
   *
   * The caller is responsible for configuring auth interceptors on the
   * custom transport; the SDK's built-in auth interceptor is bypassed.
   *
   * @example
   * ```typescript
   * import { createConnectTransport } from "@connectrpc/connect-node";
   * import { Stigmer } from "@stigmer/sdk";
   *
   * const stigmer = new Stigmer({
   *   baseUrl: "https://api.stigmer.ai",
   *   customTransport: createConnectTransport({
   *     baseUrl: "https://api.stigmer.ai",
   *     httpVersion: "2",
   *   }),
   * });
   * ```
   */
  readonly customTransport?: Transport;
}

/**
 * Validate a StigmerConfig and throw a descriptive error for invalid configurations.
 */
export function validateConfig(config: StigmerConfig): void {
  if (!config.baseUrl) {
    throw new Error("stigmer: baseUrl is required");
  }

  // When a custom transport is supplied, auth fields are optional — the
  // caller is responsible for wiring auth interceptors on the transport.
  if (config.customTransport) {
    return;
  }

  const hasApiKey = typeof config.apiKey === "string" && config.apiKey.length > 0;
  const hasTokenProvider = typeof config.getAccessToken === "function";

  if (!hasApiKey && !hasTokenProvider) {
    throw new Error(
      "stigmer: either apiKey or getAccessToken must be provided",
    );
  }

  if (hasApiKey && hasTokenProvider) {
    throw new Error(
      "stigmer: apiKey and getAccessToken are mutually exclusive — provide one, not both",
    );
  }
}
