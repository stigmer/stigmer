/**
 * The server's interceptor chain, in the ratified order (D2 §2):
 *
 *   1. identity source  — REQUIRED parameter, outermost (DD-004; O2)
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
 * unauthenticated transport.
 */
import type { Interceptor } from "@connectrpc/connect";

import type { Logger } from "../boot/logger.js";
import { createApiResourceInterceptor } from "./interceptors/apiresource.js";
import { createLoggingInterceptor } from "./interceptors/logging.js";
import { createProtovalidateInterceptor } from "./interceptors/protovalidate.js";

export function buildInterceptorChain(
  logger: Logger,
  identitySource: Interceptor,
): Interceptor[] {
  return [
    identitySource,
    createLoggingInterceptor(logger),
    createProtovalidateInterceptor(),
    createApiResourceInterceptor(),
  ];
}
