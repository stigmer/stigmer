/**
 * Authentication seam — chain position 1, a deliberate pass-through
 * (DD-004, parent project).
 *
 * Phase 1 changes no security posture: the OSS server trusts its local
 * caller exactly as the Go server does. The slot exists so phase-3 server
 * mode can drop a real authenticator into an already-reserved outermost
 * position — an implementation change, not a chain restructuring. Outermost
 * is deliberate: when auth arrives, it must run before anything else
 * observes the request.
 */
import type { Interceptor } from "@connectrpc/connect";

export function createAuthPassThroughInterceptor(): Interceptor {
  return (next) => (request) => next(request);
}
