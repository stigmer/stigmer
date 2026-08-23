/**
 * The server's interceptor chain, in the ratified order (D2 §2):
 *
 *   1. auth seam        — pass-through slot, outermost (DD-004)
 *   2. logging          — level-tiered per outcome
 *   3. protovalidate    — boundary validation before any handler
 *   4. apiresource      — kind context from the service option
 *
 * ConnectRPC applies array order as nesting order (first = outermost),
 * verified by spike SP-B. The SAME chain serves external transports and
 * in-process router-transport calls — validation parity is the point.
 */
import type { Interceptor } from "@connectrpc/connect";

import type { Logger } from "../boot/logger.js";
import { createApiResourceInterceptor } from "./interceptors/apiresource.js";
import { createAuthPassThroughInterceptor } from "./interceptors/auth.js";
import { createLoggingInterceptor } from "./interceptors/logging.js";
import { createProtovalidateInterceptor } from "./interceptors/protovalidate.js";

export function buildInterceptorChain(logger: Logger): Interceptor[] {
  return [
    createAuthPassThroughInterceptor(),
    createLoggingInterceptor(logger),
    createProtovalidateInterceptor(),
    createApiResourceInterceptor(),
  ];
}
