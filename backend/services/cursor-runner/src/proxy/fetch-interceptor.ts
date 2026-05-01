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

function isCursorRequest(url: string): boolean {
  try {
    const parsed = new URL(url);
    return CURSOR_DOMAINS.some((d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * Rewrites a Cursor-bound URL to route through the Stigmer proxy.
 *
 * Example:
 *   https://api2.cursor.sh/aiserver.v1.AgentService/CreateAgent
 *   -> https://api.stigmer.ai/v1/proxy/cursor/api2.cursor.sh/aiserver.v1.AgentService/CreateAgent
 *
 * The proxy uses the embedded original hostname to route to the correct
 * upstream Cursor service.
 */
function rewriteUrl(originalUrl: string, proxyEndpoint: string): string {
  const parsed = new URL(originalUrl);
  const proxyBase = proxyEndpoint.replace(/\/+$/, "");
  return `${proxyBase}/v1/proxy/cursor/${parsed.hostname}${parsed.pathname}${parsed.search}`;
}

function replaceAuth(init: RequestInit | undefined, config: ProxyConfig): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${config.stigmerToken}`);
  if (config.executionId) {
    headers.set("x-stigmer-execution-id", config.executionId);
  }
  return { ...init, headers };
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

  return originalFetch(rewrittenUrl, rewrittenInit);
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
 * Update the execution ID on the active interceptor. Called at the start
 * of each Temporal activity to scope proxy requests to the current
 * execution. Temporal workers process one activity at a time per slot,
 * so a mutable config is safe here.
 */
export function setInterceptorExecutionId(executionId: string | undefined): void {
  if (interceptorConfig) {
    interceptorConfig = { ...interceptorConfig, executionId };
  }
}

/**
 * Remove the interceptor and restore the original fetch. Primarily for
 * testing.
 */
export function uninstallFetchInterceptor(): void {
  interceptorConfig = null;
  globalThis.fetch = originalFetch;
}
