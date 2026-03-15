import type { Interceptor } from "@connectrpc/connect";
import type { TokenProvider } from "./types";

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

/**
 * Interceptor that strips gRPC status-code prefixes (e.g., `[internal]`)
 * from error messages before they reach application code. This produces
 * cleaner user-facing error text without losing the structured error code
 * (which remains on the `ConnectError.code` property).
 */
export const errorStripInterceptor: Interceptor =
  (next) => async (request) => {
    try {
      return await next(request);
    } catch (error: unknown) {
      if (error instanceof Error && error.message) {
        error.message = error.message.replace(/^\[.*?]\s*/, "");
      }
      throw error;
    }
  };
