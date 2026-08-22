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

import { TimingRecorder, emitTimingLog } from "../../shared/cold-start-timing.js";

/** One REST path's timing identity: the emitted timeline event and its
 * single segment name. */
interface TimedRestPath {
  readonly event: string;
  readonly segment: string;
}

/**
 * REST paths worth timing individually — both sit inside Agent.create/
 * Agent.resume on the user-visible resolve_agent setup path, and in proxy
 * mode each is a runner → Stigmer → Cursor double hop. The emitted
 * timelines split that network cost out of the segment total without
 * touching the SDK:
 *
 * - GET /v1/models (`cursor_models_fetch`): the SDK's model-id validation
 *   read, ~0.95s of the pre-cache resolve_agent segment (issue #209).
 * - POST /auth/exchange_user_api_key (`cursor_token_exchange`): the SDK's
 *   API-key → access-token exchange, the strongest suspect for the
 *   remaining unexplained 0.6–1.3s inside Agent.create
 *   (stigmer-cloud#484 — this timeline is that issue's Step 1, measure).
 */
const TIMED_REST_PATHS: ReadonlyMap<string, TimedRestPath> = new Map([
  ["/v1/models", { event: "cursor_models_fetch", segment: "models_fetch" }],
  [
    "/auth/exchange_user_api_key",
    { event: "cursor_token_exchange", segment: "token_exchange" },
  ],
]);

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
 * Connect RPC path prefixes used by the Cursor SDK. Most requests with
 * these prefixes go through connect-node (native HTTP/2) and are handled
 * by the HTTP/2 interceptor. However, some SDK calls to these paths use
 * fetch (HTTP/1.1) instead — e.g. BootstrapStatsig, LogStatsigExposure.
 * Those still need proxy auth injection even though they don't need URL
 * rewriting.
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

/**
 * Determines whether a fetch request needs URL rewriting through the
 * CursorProxyController (/v1/proxy/cursor/...). This applies to REST
 * calls (token exchange, /v1/models, agent CRUD) but NOT to Connect
 * RPC paths which are dispatched directly by path routing.
 */
function needsUrlRewrite(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (CURSOR_DOMAINS.some((d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`))) {
      return true;
    }
    if (interceptorConfig && isProxyEndpointHost(parsed, interceptorConfig.proxyEndpoint)) {
      return !isConnectRpcPath(parsed.pathname) && !parsed.pathname.startsWith("/v1/proxy/");
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Determines whether a fetch request targets the proxy endpoint with a
 * Connect-RPC-like path. The Cursor SDK sends some /aiserver.v1.* calls
 * (BootstrapStatsig, analytics, telemetry) via fetch (HTTP/1.1) rather
 * than connect-node (HTTP/2). These bypass the HTTP/2 interceptor, so
 * this fetch interceptor must inject x-stigmer-auth to authenticate
 * with the BiDi proxy. The URL is NOT rewritten — path routing delivers
 * them to the BiDi proxy directly.
 */
function needsProxyAuthOnly(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!interceptorConfig) return false;
    if (!isProxyEndpointHost(parsed, interceptorConfig.proxyEndpoint)) return false;
    return isConnectRpcPath(parsed.pathname);
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

/**
 * Replaces the authorization header with the Stigmer token. Used for
 * REST calls routed through CursorProxyController, where the proxy
 * itself authenticates with Cursor using the configured API key.
 */
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

/**
 * Injects x-stigmer-auth alongside the existing authorization header.
 * Used for Connect-RPC-like paths that arrive via fetch — the BiDi
 * proxy authenticates the runner via x-stigmer-auth and forwards the
 * original authorization (Cursor access token) to upstream Cursor.
 */
function injectProxyAuth(init: RequestInit | undefined, config: ProxyConfig): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("x-stigmer-auth", `Bearer ${config.stigmerToken}`);
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

  if (needsUrlRewrite(url)) {
    return fetchWithUrlRewrite(url, init, interceptorConfig);
  }

  if (needsProxyAuthOnly(url)) {
    return fetchWithProxyAuth(url, init, interceptorConfig);
  }

  return originalFetch(input, init);
};

/**
 * REST path: rewrite URL to /v1/proxy/cursor/{upstream}{path} and
 * replace auth with Stigmer token for CursorProxyController.
 */
async function fetchWithUrlRewrite(
  url: string, init: RequestInit | undefined, config: ProxyConfig,
): Promise<Response> {
  const rewrittenUrl = rewriteUrl(url, config.proxyEndpoint);
  const rewrittenInit = replaceAuth(init, config);
  const path = extractPath(url);
  const timedPath = TIMED_REST_PATHS.get(path);
  const timing = timedPath ? new TimingRecorder() : undefined;

  try {
    const response = await originalFetch(rewrittenUrl, rewrittenInit);

    if (timedPath && timing) {
      emitRestTiming(timedPath, timing, config, response.status);
    }

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
}

/**
 * Emit the timeline for one proxied REST call on a timed path.
 *
 * `execution_id` comes from the AsyncLocalStorage execution context — the
 * whole ExecuteCursor activity runs inside runWithExecutionContext, so the
 * value is correct even with concurrent activities on one runner process.
 * `recordTimingMetric` deliberately ignores these events (no mapped OTel
 * instruments): they are forensic stdout lines only, joined to the
 * execution_setup timeline by execution_id in cold-start-baseline analysis.
 */
function emitRestTiming(
  timedPath: TimedRestPath,
  timing: TimingRecorder,
  config: ProxyConfig,
  httpStatus: number,
): void {
  timing.mark(timedPath.segment);
  emitTimingLog(timedPath.event, {
    execution_id: executionContext.getStore()?.executionId ?? config.executionId,
    http_status: httpStatus,
  }, timing);
}

/**
 * Connect-RPC-via-fetch path: inject x-stigmer-auth for BiDi proxy
 * authentication without rewriting the URL or replacing authorization.
 */
async function fetchWithProxyAuth(
  url: string, init: RequestInit | undefined, config: ProxyConfig,
): Promise<Response> {
  const augmentedInit = injectProxyAuth(init, config);
  const path = extractPath(url);

  try {
    const response = await originalFetch(url, augmentedInit);

    if (!response.ok && !isNonCriticalPath(path)) {
      console.warn(
        `[proxy-interceptor] BiDi fetch request failed: ${init?.method ?? "GET"} ${path} → proxy status=${response.status}`,
      );
    }

    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[proxy-interceptor] BiDi fetch request error: ${init?.method ?? "GET"} ${path} → ${msg}`,
    );
    throw err;
  }
}

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
