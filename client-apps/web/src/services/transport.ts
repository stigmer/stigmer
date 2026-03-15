"use client";

/**
 * @deprecated This module-level singleton transport is legacy. New code should
 * use `useStigmerTransport()` from `@stigmer/rpc-client` (context-based).
 *
 * Remaining consumer: `OrgProvider` via `org-service.ts`. Full removal is
 * deferred until OrgProvider is refactored to use a service factory + hook.
 */

import { type Interceptor } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { getApiBaseUrl } from "@/config/env";
import { getAuthToken } from "@/auth/token-store";

function authInterceptor(): Interceptor {
  return (next) => async (request) => {
    const token = getAuthToken();
    if (token) {
      request.header.set("Authorization", `Bearer ${token}`);
    }
    return next(request);
  };
}

function stripCodePrefix(): Interceptor {
  return (next) => async (request) => {
    try {
      return await next(request);
    } catch (error: unknown) {
      if (error instanceof Error && error.message) {
        error.message = error.message.replace(/^\[.*?]\s*/, "");
      }
      throw error;
    }
  };
}

export const transport = createGrpcWebTransport({
  baseUrl: getApiBaseUrl(),
  useBinaryFormat: true,
  interceptors: [authInterceptor(), stripCodePrefix()],
});
