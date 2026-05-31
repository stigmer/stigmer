/**
 * Global fetch interceptor for Cursor SDK proxy support.
 *
 * In cloud mode, the cursor-runner must be credential-free -- it holds only
 * STIGMER_TOKEN, never CURSOR_API_KEY. To achieve this, we intercept all
 * outbound fetch() calls to Cursor's backend and rewrite them to go through
 * Stigmer's CursorProxyController, which injects the real Cursor API key.
 *
 * This is the JavaScript-level equivalent of LangChain's base_url parameter
 * that the Python agent-runner uses for the LLM proxy pattern.
 *
 * IMPORTANT: This module must be imported BEFORE @cursor/sdk to ensure the
 * interceptor is in place when the SDK initializes its HTTP client.
 *
 * When STIGMER_PROXY_ENDPOINT is not set, this module is a no-op.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const CURSOR_DOMAINS = [
  "api2.cursor.sh",
  "api.cursor.com",
  "api.cursor.sh",
];

interface ProxyConfig {
  proxyEndpoint: string;
  stigmerToken: string;
  executionId?: string;
}

let interceptorConfig: ProxyConfig | null = null;
const originalFetch = globalThis.fetch;

interface ExecutionContextStore {
  executionId: string;
}

const executionContext = new AsyncLocalStorage<ExecutionContextStore>();

export function getExecutionContext(): AsyncLocalStorage<ExecutionContextStore> {
  return executionContext;
}

/**
 * Connect RPC path prefixes used by the Cursor SDK. Requests with these
 * prefixes are handled by connect-node (native HTTP/2) and should NOT be
 * rewritten — they go directly to the proxy endpoint where path routing
 * dispatches them to the BiDi proxy on port 8082.
 */
const CONNECT_RPC_PREFIXES = ["/agent.v1.", "/aiserver.v1."];

function isConnectRpcPath(pathname: string): boolean {
  return CONNECT_RPC_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Checks whether the URL targets the proxy endpoint itself. When
 * CURSOR_BACKEND_URL is set to proxyEndpoint, SDK REST calls (token
 * exchange, CloudApiClient) target this host instead of Cursor domains.
 */
function isProxyEndpointHost(parsed: URL, proxyEndpoint: string): boolean {
  try {
    const proxy = new URL(proxyEndpoint);
    return parsed.hostname === proxy.hostname && parsed.port === proxy.port;
  } catch {
    return false;
  }
}

function isCursorRequest(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (CURSOR_DOMAINS.some((d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`))) {
      return true;
    }
    // When CURSOR_BACKEND_URL = proxyEndpoint, SDK REST calls (token exchange,
    // CloudApiClient) target the proxy endpoint host via fetch. Intercept these
    // so they get rewritten to /v1/proxy/cursor/{upstream} for CursorProxyController.
    // Connect RPC paths are excluded — they go directly to path routing.
    if (interceptorConfig && isProxyEndpointHost(parsed, interceptorConfig.proxyEndpoint)) {
      return !isConnectRpcPath(parsed.pathname) && !parsed.pathname.startsWith("/v1/proxy/");
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Determines the upstream Cursor host for a given REST path.
 *
 * - /auth/* → api2.cursor.sh (token exchange, served by this host)
 * - everything else → api.cursor.com (CloudApiClient REST: /v1/models, agent CRUD)
 */
function resolveUpstreamHost(pathname: string): string {
  if (pathname.startsWith("/auth/") || pathname === "/auth") {
    return "api2.cursor.sh";
  }
  return "api.cursor.com";
}

/**
 * Rewrites a Cursor-bound URL to route through the Stigmer proxy.
 *
 * Two cases:
 * 1. Direct Cursor-domain request (e.g. from CloudApiClient when CURSOR_BACKEND_URL unset):
 *    https://api2.cursor.sh/auth/exchange_user_api_key
 *    → https://api.stigmer.ai/v1/proxy/cursor/api2.cursor.sh/auth/exchange_user_api_key
 *
 * 2. Proxy-endpoint-targeted REST (when CURSOR_BACKEND_URL = proxyEndpoint):
 *    http://localhost:9090/auth/exchange_user_api_key
 *    → http://localhost:9090/v1/proxy/cursor/api2.cursor.sh/auth/exchange_user_api_key
 *    The upstream host is inferred from the path since it's not in the URL.
 *
 * The proxy uses the embedded original hostname to route to the correct
 * upstream Cursor service.
 */
function rewriteUrl(originalUrl: string, proxyEndpoint: string): string {
  const parsed = new URL(originalUrl);
  const proxyBase = proxyEndpoint.replace(/\/+$/, "");

  // Proxy-endpoint-targeted request: CURSOR_BACKEND_URL sent this here.
  // The hostname IS the proxy, so infer the upstream from the path.
  if (interceptorConfig && isProxyEndpointHost(parsed, proxyEndpoint)) {
    const upstream = resolveUpstreamHost(parsed.pathname);
    return `${proxyBase}/v1/proxy/cursor/${upstream}${parsed.pathname}${parsed.search}`;
  }

  // Direct Cursor-domain request: hostname IS the upstream.
  return `${proxyBase}/v1/proxy/cursor/${parsed.hostname}${parsed.pathname}${parsed.search}`;
}

function replaceAuth(init: RequestInit | undefined, config: ProxyConfig): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${config.stigmerToken}`);
  const ctx = executionContext.getStore();
  const effectiveExecutionId = ctx?.executionId ?? config.executionId;
  if (effectiveExecutionId) {
    headers.set("x-stigmer-execution-id", effectiveExecutionId);
  }
  return { ...init, headers };
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Paths that Cursor SDK calls for analytics, telemetry, or feature flags.
 * Failures on these endpoints are non-critical and should not pollute logs.
 */
const NON_CRITICAL_PATHS = [
  "/aiserver.v1.AnalyticsService/BootstrapStatsig",
  "/aiserver.v1.AnalyticsService/LogStatsigExposure",
  "/aiserver.v1.AnalyticsService/LogStatsigEvent",
  "/analytics/",
  "/telemetry/",
];

function isNonCriticalPath(path: string): boolean {
  return NON_CRITICAL_PATHS.some(p => path.includes(p));
}

const interceptedFetch: typeof fetch = async (input, init) => {
  if (!interceptorConfig) {
    return originalFetch(input, init);
  }

  const url = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input instanceof Request
        ? input.url
        : String(input);

  if (!isCursorRequest(url)) {
    return originalFetch(input, init);
  }

  const rewrittenUrl = rewriteUrl(url, interceptorConfig.proxyEndpoint);
  const rewrittenInit = replaceAuth(init, interceptorConfig);
  const path = extractPath(url);

  try {
    const response = await originalFetch(rewrittenUrl, rewrittenInit);

    if (!response.ok) {
      if (isNonCriticalPath(path)) {
        console.debug(
          `[proxy-interceptor] Non-critical Cursor request failed (expected): ${init?.method ?? "GET"} ${path} → proxy status=${response.status}`,
        );
      } else {
        console.warn(
          `[proxy-interceptor] Cursor request failed: ${init?.method ?? "GET"} ${path} → proxy status=${response.status}`,
        );
      }
    }

    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[proxy-interceptor] Cursor request error: ${init?.method ?? "GET"} ${path} → ${msg}`,
    );
    throw err;
  }
};

/**
 * Install the global fetch interceptor. Call once at startup, BEFORE
 * importing @cursor/sdk.
 *
 * When proxyEndpoint is empty or not provided, the interceptor is not
 * installed and all fetch calls pass through to the original implementation.
 */
export function installFetchInterceptor(config: {
  proxyEndpoint: string | undefined;
  stigmerToken: string | undefined;
}): void {
  if (!config.proxyEndpoint) {
    return;
  }

  if (!config.stigmerToken) {
    throw new Error(
      "STIGMER_TOKEN is required when STIGMER_PROXY_ENDPOINT is set. " +
      "In proxy mode, the runner authenticates with Stigmer's proxy using STIGMER_TOKEN.",
    );
  }

  interceptorConfig = {
    proxyEndpoint: config.proxyEndpoint,
    stigmerToken: config.stigmerToken,
  };

  globalThis.fetch = interceptedFetch;

  console.log(
    `Cursor proxy interceptor installed: Cursor traffic → ${config.proxyEndpoint}/v1/proxy/cursor/`,
  );
}

/**
 * Update the auth token on the live interceptor config. Must be called
 * whenever the Stigmer JWT is refreshed (e.g. via IPC updateToken) so
 * that fetch-intercepted REST calls (token exchange, /v1/models) use the
 * current token instead of the one frozen at install time.
 */
export function updateInterceptorToken(token: string): void {
  if (interceptorConfig) {
    interceptorConfig = { ...interceptorConfig, stigmerToken: token };
  }
}

/**
 * Update the execution ID on the active interceptor (legacy global path).
 * Prefer {@link runWithExecutionContext} for concurrent-safe isolation.
 *
 * @deprecated Use runWithExecutionContext() instead for concurrent activities.
 */
export function setInterceptorExecutionId(executionId: string | undefined): void {
  if (interceptorConfig) {
    interceptorConfig = { ...interceptorConfig, executionId };
  }
}

/**
 * Run an async function with execution-scoped context. The executionId is
 * propagated through the async call chain via AsyncLocalStorage, ensuring
 * concurrent activities on the same runner process don't overwrite each
 * other's proxy headers.
 */
export function runWithExecutionContext<T>(
  executionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return executionContext.run({ executionId }, fn);
}

/**
 * Remove the interceptor and restore the original fetch. Primarily for
 * testing.
 */
export function uninstallFetchInterceptor(): void {
  interceptorConfig = null;
  globalThis.fetch = originalFetch;
}
