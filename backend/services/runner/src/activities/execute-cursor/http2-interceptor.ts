/**
 * HTTP/2 session interceptor for Cursor SDK Connect RPC proxy support.
 *
 * The Cursor SDK's Connect RPC transport (@connectrpc/connect-node) uses
 * Node's native `http2` module, completely bypassing globalThis.fetch.
 * This means the fetch interceptor (fetch-interceptor.ts) cannot inject
 * the `x-stigmer-execution-id` header on BiDi streams.
 *
 * CHALLENGE: connect-node uses `import * as http2 from "node:http2"`. Node
 * builds that ESM namespace by snapshotting the builtin's CJS exports at the
 * FIRST `import` of the module, then freezes the namespace bindings. Patching
 * `http2.connect` via `require()` mutates the shared CJS singleton, and that
 * mutation is only visible to ESM namespace imports performed AFTER the patch.
 * If connect-node imports `node:http2` first, its namespace is already frozen
 * to the original `connect` and our later patch is invisible to it.
 *
 * LOAD ORDER IS THEREFORE LOAD-BEARING: this interceptor MUST be installed
 * before the first connect-node import in the process. The runner enforces this
 * by (a) keeping connect-node out of the pre-install static module graph
 * (bootstrap.ts loads StigmerClient via dynamic import) and (b) installing this
 * interceptor before resolving Temporal coordinates / importing the SDK in the
 * runner factories. assertHttp2ConnectPatched() verifies the ESM-facade view at
 * boot so any future regression fails loudly instead of silently 401-ing.
 *
 * This module patches `http2.connect()` to wrap returned sessions. The
 * wrapped session's `request()` method reads the execution ID from the
 * shared AsyncLocalStorage and injects it as an HTTP/2 header on each
 * stream targeting the proxy endpoint.
 *
 * This is the same instrumentation approach used by OpenTelemetry's
 * @opentelemetry/instrumentation-http2 for Node.js HTTP/2 tracing.
 *
 * EXIT CONDITION: This patch becomes unnecessary if @cursor/sdk ever
 * exposes a mechanism to inject custom headers on its Connect RPC
 * transport (e.g., interceptors option, defaultHeaders config, or a
 * transport factory). At that point, replace this with a single Connect
 * interceptor and remove the http2 patch.
 *
 * IMPORTANT: This module must be imported and installed BEFORE @cursor/sdk
 * to ensure the patch is in place when the SDK opens its HTTP/2 session.
 */

import { createRequire } from "node:module";
import type http2Type from "node:http2";
import { getExecutionContext } from "./fetch-interceptor.js";

// Use require() to get the ACTUAL CJS module singleton. Mutations here
// are visible to all importers including ESM namespace imports, because
// Node.js builtins expose a single shared exports object.
const require = createRequire(import.meta.url);
const http2: typeof http2Type = require("node:http2");

const EXECUTION_ID_HEADER = "x-stigmer-execution-id";
const STIGMER_AUTH_HEADER = "x-stigmer-auth";

interface Http2InterceptorConfig {
  proxyHostname: string;
  proxyPort: string;
  stigmerToken: string;
}

let config: Http2InterceptorConfig | null = null;
let originalConnect: typeof http2.connect = http2.connect;

// Tracks all wrapped proxy sessions for inter-activity lifecycle management.
// Sessions are added on wrap and auto-removed on close.
const proxySessions = new Set<http2Type.ClientHttp2Session>();

/**
 * Parses an authority (URL or host:port string) into hostname + port
 * for comparison against the configured proxy endpoint.
 */
function parseAuthority(authority: string | URL): { hostname: string; port: string } | null {
  try {
    const url = authority instanceof URL ? authority : new URL(authority);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return { hostname: url.hostname, port };
  } catch {
    return null;
  }
}

function isProxyAuthority(authority: string | URL): boolean {
  if (!config) return false;
  const parsed = parseAuthority(authority);
  if (!parsed) return false;
  return parsed.hostname === config.proxyHostname && parsed.port === config.proxyPort;
}

/**
 * Wraps a ClientHttp2Session's `request()` method to inject the
 * execution ID header from the current AsyncLocalStorage context.
 *
 * HTTP/2 multiplexes multiple streams on a single connection, so
 * different executions may share the same session. Reading from ALS
 * at request() time (per-stream) is the correct approach.
 */
function wrapSession(session: http2Type.ClientHttp2Session): http2Type.ClientHttp2Session {
  proxySessions.add(session);
  session.once("close", () => proxySessions.delete(session));

  const originalRequest = session.request.bind(session);

  session.request = function patchedRequest(
    headers?: http2Type.OutgoingHttpHeaders,
    options?: http2Type.ClientSessionRequestOptions,
  ): http2Type.ClientHttp2Stream {
    if (!config) {
      return originalRequest(headers, options);
    }

    const ctx = getExecutionContext().getStore();
    const augmented: http2Type.OutgoingHttpHeaders = {
      ...headers,
      [STIGMER_AUTH_HEADER]: `Bearer ${config.stigmerToken}`,
    };
    if (ctx?.executionId) {
      augmented[EXECUTION_ID_HEADER] = ctx.executionId;
    }
    return originalRequest(augmented, options);
  } as typeof session.request;

  return session;
}

/**
 * Install the HTTP/2 interceptor. Call once at startup, BEFORE importing
 * @cursor/sdk.
 *
 * When proxyEndpoint is not provided, the interceptor is not installed
 * and all http2.connect() calls pass through to the original.
 */
export function installHttp2Interceptor(opts: {
  proxyEndpoint: string | undefined;
  stigmerToken: string | undefined;
}): void {
  if (!opts.proxyEndpoint) {
    return;
  }

  if (!opts.stigmerToken) {
    return;
  }

  const parsed = parseAuthority(opts.proxyEndpoint);
  if (!parsed) {
    console.warn(
      `[http2-interceptor] Could not parse proxyEndpoint "${opts.proxyEndpoint}", skipping install`,
    );
    return;
  }

  config = { proxyHostname: parsed.hostname, proxyPort: parsed.port, stigmerToken: opts.stigmerToken };
  originalConnect = http2.connect;

  http2.connect = function patchedConnect(
    authority: string | URL,
    optionsOrListener?: any,
    listener?: any,
  ): http2Type.ClientHttp2Session {
    const isProxy = isProxyAuthority(authority);
    const session = originalConnect.call(http2, authority as any, optionsOrListener, listener);

    if (isProxy) {
      return wrapSession(session);
    }

    return session;
  } as typeof http2.connect;

  console.log(
    `[http2-interceptor] Installed: Connect RPC streams to ${parsed.hostname}:${parsed.port} ` +
      `will carry x-stigmer-auth + x-stigmer-execution-id`,
  );
}

/**
 * Verify the patch is visible to ESM namespace importers of `node:http2`
 * (i.e. @connectrpc/connect-node). Call once at boot, immediately after
 * {@link installHttp2Interceptor}.
 *
 * Unlike the CJS `require("node:http2")` singleton, the ESM namespace produced
 * by `import * as http2 from "node:http2"` is snapshotted at the module's first
 * import and frozen. If connect-node imported `node:http2` before the patch was
 * applied, this namespace still exposes the ORIGINAL `connect`, so BiDi streams
 * would silently omit `x-stigmer-auth` and hit HTTP 401. Importing the module
 * here and comparing `ns.connect` against our patched `http2.connect` is the
 * only honest check — comparing two `require()` views is tautological because
 * they are the same object.
 *
 * No-op when the interceptor is not configured (no proxy/token), since there is
 * nothing to patch in that case.
 *
 * @throws if the interceptor is configured but the ESM facade is unpatched —
 * a load-order regression that must fail loudly at boot, not at request time.
 */
export async function assertHttp2ConnectPatched(): Promise<void> {
  if (!config) {
    return;
  }

  const ns = await import("node:http2");
  if (ns.connect !== http2.connect) {
    throw new Error(
      "[http2-interceptor] node:http2 ESM facade is unpatched: connect-node imported " +
        "node:http2 before installHttp2Interceptor() ran, so its frozen namespace still " +
        "holds the original http2.connect. BiDi streams would omit x-stigmer-auth and 401. " +
        "Fix the load order: keep @connectrpc/connect-node out of the pre-install static " +
        "module graph (load StigmerClient via dynamic import) and install this interceptor " +
        "before resolving Temporal coordinates / importing @cursor/sdk. See bootstrap.ts " +
        "and the runner factories.",
    );
  }
}

/**
 * Update the auth token on the live interceptor config. Must be called
 * whenever the Stigmer JWT is refreshed (e.g. via IPC updateToken) so
 * that HTTP/2-intercepted streams use the current token instead of the
 * one frozen at install time.
 */
export function updateHttp2InterceptorToken(token: string): void {
  if (config) {
    config = { ...config, stigmerToken: token };
  }
}

/**
 * Remove the interceptor and restore the original http2.connect.
 * Primarily for testing.
 */
export function uninstallHttp2Interceptor(): void {
  config = null;
  http2.connect = originalConnect;
  proxySessions.clear();
}

/**
 * Close all tracked HTTP/2 sessions to the proxy endpoint, forcing
 * the SDK to establish a fresh connection on next use.
 *
 * Call between sequential workflow task activities to prevent a
 * degraded session from one task poisoning the next. No-op when
 * no sessions are tracked (e.g., first activity in a workflow).
 */
export function closeProxySessions(): void {
  for (const session of proxySessions) {
    if (!session.closed && !session.destroyed) {
      session.close();
    }
  }
  proxySessions.clear();
}
