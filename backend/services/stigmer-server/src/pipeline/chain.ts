/**
 * The server's interceptor chain, in the ratified order (D2 §2; position
 * 0 added by 20260830.03, gate ruling Q1):
 *
 *   0. error boundary   — SERVING chain only, optional parameter
 *                         (interceptors/error-boundary.ts: the raw-error
 *                         conversion net + the visitor sanitizer seam)
 *   1. identity source  — REQUIRED parameter (DD-004; O2)
 *   2. logging          — level-tiered per outcome
 *   3. protovalidate    — boundary validation before any handler
 *   4. apiresource      — kind context from the service option
 *
 * ConnectRPC applies array order as nesting order (first = outermost),
 * verified by spike SP-B. Positions 2–4 are the SAME for external
 * transports and in-process router-transport calls — validation parity is
 * the point. Position 1 deliberately differs per transport (O2, ruling
 * Q4): the serving chain runs the verifier chassis over the wire's
 * credentials, the in-process chain stamps the internal caller class its
 * own interceptor mints (interceptors/auth.ts owns both sources and the
 * spoofing-impossible invariant). The parameter is required — a chain
 * without an identity source is a compile error, never a silently
 * unauthenticated transport. Position 0 deliberately exists ONLY on the
 * serving chain: in-process hops are exempt from sanitization by
 * construction — the outer handler needs the full inner diagnostic (the
 * Java InProcessCallContextHolder exemption, structurally).
 */
import type { Interceptor } from "@connectrpc/connect";

import type { Logger } from "../boot/logger.js";
import { createApiResourceInterceptor } from "./interceptors/apiresource.js";
import { createLoggingInterceptor } from "./interceptors/logging.js";
import { createProtovalidateInterceptor } from "./interceptors/protovalidate.js";

export function buildInterceptorChain(
  logger: Logger,
  identitySource: Interceptor,
  errorBoundary?: Interceptor,
): Interceptor[] {
  return [
    ...(errorBoundary === undefined ? [] : [errorBoundary]),
    identitySource,
    createLoggingInterceptor(logger),
    createProtovalidateInterceptor(),
    createApiResourceInterceptor(),
  ];
}
