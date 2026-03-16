import { ConnectError, Code, type Interceptor } from "@connectrpc/connect";
import type { TokenProvider } from "../config.js";

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
