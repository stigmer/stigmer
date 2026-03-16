import { ConnectError, Code, type Interceptor } from "@connectrpc/connect";
import type { TokenProvider } from "../config.js";
import { annotateRpcError } from "../errors.js";

/**
 * Create an interceptor that attaches `Authorization: Bearer <token>` to
 * every outgoing request. Supports both static API keys and dynamic token
 * providers.
 */
export function createAuthInterceptor(
  getAccessToken: TokenProvider,
): Interceptor {
  return (next) => async (request) => {
    const token = await getAccessToken();
    if (token) {
      request.header.set("Authorization", `Bearer ${token}`);
    }
    return next(request);
  };
}

/**
 * Interceptor that annotates every error with the RPC method name and
 * service path that produced it. Must run before error-transforming
 * interceptors so the raw request context is available.
 */
export const rpcMetadataInterceptor: Interceptor =
  (next) => async (request) => {
    try {
      return await next(request);
    } catch (error: unknown) {
      if (error !== null && typeof error === "object") {
        const segments = request.url.split("/");
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

/**
 * Interceptor that strips gRPC status-code prefixes (e.g., `[internal]`)
 * from error messages. The structured code remains on `ConnectError.code`.
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

/**
 * Create an interceptor that invokes a callback on UNAUTHENTICATED (code 16).
 * The callback fires at most once per client to prevent cascading redirects.
 */
export function createAuthRedirectInterceptor(
  onUnauthenticated: () => void,
): Interceptor {
  let fired = false;
  return (next) => async (request) => {
    try {
      return await next(request);
    } catch (error: unknown) {
      if (
        !fired &&
        error instanceof ConnectError &&
        error.code === Code.Unauthenticated
      ) {
        fired = true;
        onUnauthenticated();
      }
      throw error;
    }
  };
}
