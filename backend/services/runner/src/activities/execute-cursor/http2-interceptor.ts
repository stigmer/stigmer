/**
 * HTTP/2 session interceptor for Cursor SDK Connect RPC proxy support.
 *
 * The Cursor SDK's Connect RPC transport (@connectrpc/connect-node) uses
 * Node's native `http2` module, completely bypassing globalThis.fetch.
 * This means the fetch interceptor (fetch-interceptor.ts) cannot inject
 * the `x-stigmer-execution-id` header on BiDi streams.
 *
 * CHALLENGE: connect-node uses `import * as http2 from "node:http2"` which
 * creates an ESM namespace. Patching `http2.connect` via a default ESM import
 * does NOT propagate to namespace imports — this is a Node.js ESM interop
 * limitation for built-in modules. The fix is to patch via `require()`
 * (CJS), which modifies the actual module singleton visible to all importers.
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

  // Verify the patch took effect on the module singleton
  const verify = require("node:http2");
  const patchVisible = verify.connect === http2.connect && verify.connect.name === "patchedConnect";

  console.log(
    `[http2-interceptor] Installed: Connect RPC streams to ${parsed.hostname}:${parsed.port} ` +
      `will carry x-stigmer-auth + x-stigmer-execution-id (patch verified: ${patchVisible})`,
  );
}

/**
 * Remove the interceptor and restore the original http2.connect.
 * Primarily for testing.
 */
export function uninstallHttp2Interceptor(): void {
  config = null;
  http2.connect = originalConnect;
}
