/**
 * The server's interceptor chain, in order:
 *
 *   0. error boundary   — SERVING chain only
 *                         (interceptors/error-boundary.ts: the raw-error
 *                         conversion net + the visitor sanitizer seam)
 *   1. identity source  — REQUIRED parameter
 *      request metrics  — SERVING chain only, immediately inside the
 *                         identity source (interceptors/request-metrics.ts:
 *                         Java's RED emitter at Java's position — an
 *                         identity refusal is position 1's own record,
 *                         never a counted error)
 *   2. logging          — level-tiered per outcome
 *      single-org fill  — SERVING chain only, and only on a composition
 *                         that declares one organization
 *                         (interceptors/single-organization.ts: an empty
 *                         `org` is the server's one organization, filled
 *                         before validation and the handler read it)
 *   3. protovalidate    — boundary validation before any handler
 *      org names        — SERVING chain only, every edition
 *                         (interceptors/organization-names.ts: every
 *                         organization a request names by slug becomes its
 *                         id, before authorization and the handler read it)
 *      deleting orgs    — BOTH chains, when the composition passes it
 *                         (domain/organization/lifecycle.ts: a request
 *                         that names an organization being deleted answers
 *                         as if it did not exist, the in-process lane
 *                         included, so server code cannot start work there)
 *   4. apiresource      — kind context from the service option
 *
 * ConnectRPC applies array order as nesting order (first = outermost),
 * verified by a spike. Positions 2–4 are the SAME for external
 * transports and in-process router-transport calls — validation parity is
 * the point. Position 1 deliberately differs per transport: the serving
 * chain runs the verifier chassis over the wire's
 * credentials, the in-process chain stamps the internal caller class its
 * own interceptor mints (interceptors/auth.ts owns both sources and the
 * spoofing-impossible invariant). The parameter is required — a chain
 * without an identity source is a compile error, never a silently
 * unauthenticated transport.
 *
 * The serving-only interceptors travel as ONE optional parameter so
 * a chain cannot half-inherit them: in-process hops are exempt from
 * sanitization by construction — the outer handler needs the full inner
 * diagnostic (the Java InProcessCallContextHolder exemption,
 * structurally) — and an in-process hop is not a request, so it is not
 * counted as one.
 */
import type { Interceptor } from "@connectrpc/connect";

import type { Logger } from "../boot/logger.js";
import { createApiResourceInterceptor } from "./interceptors/apiresource.js";
import { createLoggingInterceptor } from "./interceptors/logging.js";
import { createProtovalidateInterceptor } from "./interceptors/protovalidate.js";

/** The interceptors only the serving chain composes; the in-process chain passes none. */
export interface ServingChainInterceptors {
  readonly errorBoundary: Interceptor;
  readonly requestMetrics: Interceptor;
  /** Present only when the composition declares one organization. */
  readonly singleOrganization?: Interceptor;
  /** Every organization a request names, resolved to its id. */
  readonly organizationNames: Interceptor;
}

/** The interceptors both chains compose, when the composition passes them. */
export interface SharedChainInterceptors {
  /** Refuses a request naming an organization being deleted. */
  readonly deletingOrganizations?: Interceptor;
}

export function buildInterceptorChain(
  logger: Logger,
  identitySource: Interceptor,
  serving?: ServingChainInterceptors,
  shared: SharedChainInterceptors = {},
): Interceptor[] {
  return [
    ...(serving === undefined ? [] : [serving.errorBoundary]),
    identitySource,
    ...(serving === undefined ? [] : [serving.requestMetrics]),
    createLoggingInterceptor(logger),
    ...(serving?.singleOrganization === undefined
      ? []
      : [serving.singleOrganization]),
    createProtovalidateInterceptor(),
    ...(serving === undefined ? [] : [serving.organizationNames]),
    ...(shared.deletingOrganizations === undefined
      ? []
      : [shared.deletingOrganizations]),
    createApiResourceInterceptor(),
  ];
}
