/**
 * Token provider callback for dynamic authentication.
 * Called per-request, allowing token refresh and auth state changes.
 * Return `null` to skip authentication for that request.
 */
export type TokenProvider = () => Promise<string | null> | string | null;

/**
 * Configuration for the Stigmer SDK client.
 *
 * Exactly one of `apiKey` or `getAccessToken` must be provided:
 * - `apiKey`: Static API key for server-to-server usage.
 * - `getAccessToken`: Dynamic token provider for browser or rotating credentials.
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
   * Both protocols are supported by the Stigmer server.
   */
  readonly transport?: "grpc-web" | "connect";
}

/**
 * Validate a StigmerConfig and throw a descriptive error for invalid configurations.
 */
export function validateConfig(config: StigmerConfig): void {
  if (!config.baseUrl) {
    throw new Error("stigmer: baseUrl is required");
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
