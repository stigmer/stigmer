import type { Interceptor } from "@connectrpc/connect";

/**
 * Callback that returns the current access token for authenticating RPC
 * requests. Called by the auth interceptor on every outgoing request.
 *
 * Return `null` to send unauthenticated requests (e.g., disabled auth mode).
 * May be async to support token refresh flows.
 */
export type TokenProvider = () => Promise<string | null> | string | null;

/**
 * Configuration for a Stigmer RPC transport.
 *
 * Passed to {@link createStigmerTransport} (imperative) or
 * {@link StigmerTransportProvider} (React context). The consumer — whether
 * the Stigmer web console or an external platform owner's app — provides
 * these values; the library never reads environment variables or auth state
 * directly.
 */
export interface StigmerRpcConfig {
  /** Base URL of the Stigmer server (e.g., `"http://localhost:7234"`). */
  readonly serverUrl: string;

  /**
   * Token provider invoked on every RPC request to obtain the current
   * access token. Omit for unauthenticated usage (disabled auth mode).
   */
  readonly getAccessToken?: TokenProvider;

  /**
   * Callback invoked when the server responds with UNAUTHENTICATED (code 16).
   *
   * Typically used to clear auth state and redirect to the login page.
   * Invoked at most once per transport instance to prevent duplicate
   * redirects when multiple parallel requests fail simultaneously.
   *
   * When omitted, UNAUTHENTICATED errors propagate normally without any
   * redirect behavior — suitable for embeddable consumers that handle
   * auth expiry in their own way.
   */
  readonly onUnauthenticated?: () => void;

  /**
   * Additional Connect-RPC interceptors appended after the built-in
   * interceptors. Use this for application-specific concerns like tracing
   * or custom error handling.
   */
  readonly interceptors?: Interceptor[];
}
