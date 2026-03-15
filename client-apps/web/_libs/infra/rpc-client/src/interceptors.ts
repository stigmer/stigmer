import { ConnectError, Code, type Interceptor } from "@connectrpc/connect";
import { annotateRpcError } from "./errors";
import type { TokenProvider } from "./types";

// ---------------------------------------------------------------------------
// Auth token injection
// ---------------------------------------------------------------------------

/**
 * Create an interceptor that attaches an `Authorization: Bearer <token>`
 * header to every outgoing request.
 *
 * The `getAccessToken` callback is invoked per-request, so token refresh
 * and auth state changes are picked up automatically. When the callback is
 * `undefined` (disabled auth mode) or returns `null`, no header is set.
 */
export function createAuthInterceptor(
  getAccessToken?: TokenProvider,
): Interceptor {
  return (next) => async (request) => {
    if (getAccessToken) {
      const token = await getAccessToken();
      if (token) {
        request.header.set("Authorization", `Bearer ${token}`);
      }
    }
    return next(request);
  };
}

// ---------------------------------------------------------------------------
// RPC metadata annotation
// ---------------------------------------------------------------------------

/**
 * Interceptor that annotates every {@link ConnectError} with the RPC method
 * name and service path that produced it.
 *
 * Downstream consumers (error display components, logging, observability)
 * can retrieve the metadata via {@link getRpcMetadata}.
 *
 * Must run before error-transforming interceptors (like `errorStripInterceptor`)
 * so that the raw request context is available when the error is caught.
 */
export const rpcMetadataInterceptor: Interceptor =
  (next) => async (request) => {
    try {
      return await next(request);
    } catch (error: unknown) {
      if (error !== null && typeof error === "object") {
        const url = request.url;
        const segments = url.split("/");
        const method = segments.at(-1) ?? "";
        const service = segments.at(-2) ?? "";
        annotateRpcError(error, {
          method: method.charAt(0).toLowerCase() + method.slice(1),
          path: `/${service}/${method}`,
        });
      }
      throw error;
    }
  };

// ---------------------------------------------------------------------------
// Error message cleanup
// ---------------------------------------------------------------------------

/**
 * Interceptor that strips gRPC status-code prefixes (e.g., `[internal]`)
 * from error messages before they reach application code. This produces
 * cleaner user-facing error text without losing the structured error code
 * (which remains on the `ConnectError.code` property).
 */
export const errorStripInterceptor: Interceptor = (next) => async (request) => {
  try {
    return await next(request);
  } catch (error: unknown) {
    if (error instanceof Error && error.message) {
      error.message = error.message.replace(/^\[.*?]\s*/, "");
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Auth redirect
// ---------------------------------------------------------------------------

/**
 * Create an interceptor that invokes a callback when the server responds
 * with `UNAUTHENTICATED` (code 16).
 *
 * The callback is invoked at most once — a deduplication flag prevents
 * repeated calls when multiple parallel requests all fail with the same
 * expired token. The error is always re-thrown so that TanStack Query (or
 * any other caller) sees the failure and does not retry.
 *
 * @param onUnauthenticated — called once when an UNAUTHENTICATED error is
 *   received. Typically used to clear auth state and redirect to the login
 *   page. The callback receives no arguments — the interceptor does not
 *   assume any specific auth or routing framework.
 */
export function createAuthRedirectInterceptor(
  onUnauthenticated: () => void,
): Interceptor {
  let redirecting = false;
  return (next) => async (request) => {
    try {
      return await next(request);
    } catch (error: unknown) {
      if (
        !redirecting &&
        error instanceof ConnectError &&
        error.code === Code.Unauthenticated
      ) {
        redirecting = true;
        onUnauthenticated();
      }
      throw error;
    }
  };
}
