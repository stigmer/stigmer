/**
 * Error-boundary interceptor — the serving chain's position 0, the TS
 * port of the cloud Java VisitorErrorSanitizerInterceptor posture (cloud
 * DD-005 of 20260810.02, shipped for stigmer-cloud#242; ported by
 * convergence entry 20260830.03.sp.visitor-error-sanitizer, all six gate
 * rulings as recommended).
 *
 * Two arms, one structural guarantee each:
 *
 *   1. RAW-ERROR CONVERSION (always on, gate ruling Q2): a non-ConnectError
 *      escaping any handler — the direct handlers whose internalError
 *      wrapping is per-site discipline, not structure — becomes the
 *      pipeline executor's exact sanitized Internal
 *      ("internal server error") instead of connect-node's default
 *      Unknown-with-raw-message conversion. This closes the
 *      leak-by-default class for direct handlers the way
 *      pipeline.ts closes it for chains (stigmer#478's sibling). The
 *      guidelines' self-sanitize discipline still applies — a handler's
 *      own "failed to <do thing>" copy beats this generic net.
 *
 *   2. VISITOR SANITIZATION (policy-driven, empty by default): when a
 *      composition registers a VisitorErrorPolicy, descriptions of the
 *      six leak-prone codes are rewritten for callers the policy deems
 *      on the anonymous surface (the cloud: guest / channel / is_public),
 *      the code ALWAYS preserved so SDK retry semantics stay honest, a
 *      minted support ref appended in the Java byte-pinned format, and
 *      the original description kept operator-visible via the boundary
 *      WARN (log-based correlation — the TS serving path has no OTel
 *      span to stamp, gate ruling Q3). The sanitized error is a FRESH
 *      ConnectError: details and metadata never survive sanitization
 *      (the Java trailers-drop, and rethrownStatusError's metadata
 *      lesson).
 *
 * Placement contract: OUTERMOST on the SERVING chain only (chain.ts).
 * Outermost keeps the Java pin "sanitizes even with no identity context"
 * (identity is read from contextValues at error time — stamped by
 * position 1 when the error rose from inside it, absent when position 1
 * itself refused) and covers identity-chassis faults; the logging
 * interceptor sits inside, so operators keep the ORIGINAL error at error
 * level while the wire carries the rewrite. The in-process chain never
 * composes this interceptor — in-process hops are exempt by
 * construction (the outer handler needs the full inner diagnostic), the
 * TS rendering of the Java InProcessCallContextHolder exemption.
 *
 * Streams: mid-iteration errors bypass a plain `await next(request)`
 * wrapper, so stream responses are re-wrapped with a guarded iterable —
 * without it, server-stream errors would escape both arms.
 */
import { randomBytes } from "node:crypto";
import { Code, ConnectError } from "@connectrpc/connect";
import type {
  Interceptor,
  StreamRequest,
  UnaryRequest,
} from "@connectrpc/connect";
import type { DescMethod } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { internalError } from "../errors.js";
import { INTERNAL_FALLBACK_MESSAGE } from "../pipeline.js";
import { callerIdentityKey } from "./auth.js";

/**
 * The codes whose descriptions may carry internals — the deny-leaky
 * matrix ratified by cloud DD-005 (20260810.02) and byte-pinned across
 * editions. Deliberate-refusal codes (PermissionDenied,
 * FailedPrecondition, ResourceExhausted, …) pass through untouched:
 * their descriptions are authored copy, including owner-customized
 * refusal messages and machine tokens brokers branch on.
 */
const SANITIZED_CODES: ReadonlySet<Code> = new Set([
  Code.Internal,
  Code.Unknown,
  Code.DataLoss,
  Code.Unavailable,
  Code.DeadlineExceeded,
  Code.Unimplemented,
]);

/**
 * The visitor-sanitization policy a composition registers through
 * ExtensionDrivers.visitorErrorPolicy (single-instance point). The
 * boundary owns the mechanism — the code set, code preservation, the
 * ref format, details/metadata dropping, the boundary WARN; the policy
 * owns the edition semantics — WHO is on the anonymous surface and WHAT
 * copy replaces the description.
 */
export interface VisitorErrorPolicy {
  /**
   * Whether this caller+method pair is on the anonymous surface (the
   * cloud rule: guest or channel caller class, or an is_public method).
   * Synchronous and cheap — it runs on every boundary error. `identity`
   * is undefined when the error rose from position 1 before stamping
   * (the Java "no interceptor context" arm — an is_public rule must
   * still answer there). A throw is treated as eligible: over-sanitizing
   * an org member's diagnostics is recoverable, leaking internals to a
   * visitor is not.
   */
  eligible(identity: CallerIdentity | undefined, method: DescMethod): boolean;
  /**
   * The replacement description (WITHOUT the support ref — the boundary
   * appends it). Runs only on the error path, so per-call resolution
   * work (the cloud's per-share owner copy) is admissible. A rejection
   * falls back to the pipeline's sanitized-Internal copy — never the
   * original description.
   */
  replacementCopy(
    identity: CallerIdentity | undefined,
    method: DescMethod,
  ): Promise<string>;
}

/**
 * The Java supportRef format, byte-pinned (gate ruling Q3):
 * `" (ref: <8 hex chars>)"`. Java derives the ref from the first 8 of
 * the trace id; the TS serving path has no trace id, so the boundary
 * mints one on the error path and the boundary WARN is the correlation
 * point.
 */
export function supportRefSuffix(ref: string): string {
  return ` (ref: ${ref})`;
}

function mintSupportRef(): string {
  return randomBytes(4).toString("hex");
}

/**
 * Builds the boundary for the serving chain. `policy` is the composed
 * VisitorErrorPolicy or undefined (the OSS default) — arm 1 runs either
 * way, arm 2 only with a policy.
 */
export function createErrorBoundaryInterceptor(
  logger: Logger,
  policy?: VisitorErrorPolicy,
): Interceptor {
  return (next) => async (request) => {
    let response;
    try {
      response = await next(request);
    } catch (error) {
      throw await boundaryError(error, request, logger, policy);
    }
    if (response.stream) {
      return {
        ...response,
        message: guardStreamMessages(response.message, request, logger, policy),
      };
    }
    return response;
  };
}

/** Re-raises mid-stream errors through the same two boundary arms. */
async function* guardStreamMessages<T>(
  messages: AsyncIterable<T>,
  request: UnaryRequest | StreamRequest,
  logger: Logger,
  policy: VisitorErrorPolicy | undefined,
): AsyncIterable<T> {
  try {
    yield* messages;
  } catch (error) {
    throw await boundaryError(error, request, logger, policy);
  }
}

async function boundaryError(
  error: unknown,
  request: UnaryRequest | StreamRequest,
  logger: Logger,
  policy: VisitorErrorPolicy | undefined,
): Promise<ConnectError> {
  const procedure = `/${request.service.typeName}/${request.method.name}`;

  // Arm 1: the structural raw-error conversion (Q2). The logging
  // interceptor inside already recorded unary failures; this line is the
  // only record for mid-stream and identity-chassis raws, and it names
  // the conversion the operator would otherwise not know happened.
  let connectError: ConnectError;
  if (error instanceof ConnectError) {
    connectError = error;
  } else {
    logger.error("unhandled non-ConnectError at the transport boundary", {
      procedure,
      error: error instanceof Error ? error.message : String(error),
    });
    connectError = internalError(error, INTERNAL_FALLBACK_MESSAGE);
  }

  // Arm 2: the visitor rewrite — only with a composed policy, only on
  // the leak-prone codes.
  if (policy === undefined || !SANITIZED_CODES.has(connectError.code)) {
    return connectError;
  }
  const identity = request.contextValues.get(callerIdentityKey);
  let eligible: boolean;
  try {
    eligible = policy.eligible(identity, request.method);
  } catch (policyFault) {
    // Fail toward sanitizing: the recoverable direction (see the
    // contract's eligible() doc).
    logger.error("visitor error policy eligibility check threw", {
      procedure,
      error:
        policyFault instanceof Error
          ? policyFault.message
          : String(policyFault),
    });
    eligible = true;
  }
  if (!eligible) {
    return connectError;
  }

  let copy: string;
  try {
    copy = await policy.replacementCopy(identity, request.method);
  } catch (policyFault) {
    logger.warn("visitor error copy resolution failed, using fallback", {
      procedure,
      error:
        policyFault instanceof Error
          ? policyFault.message
          : String(policyFault),
    });
    copy = INTERNAL_FALLBACK_MESSAGE;
  }

  const ref = mintSupportRef();
  // The correlation point (Q3): the visitor holds the ref, this line
  // holds the original description — the log-based rendering of the
  // Java span attribute + boundary WARN pair.
  logger.warn("sanitized a visitor-facing error", {
    procedure,
    code: Code[connectError.code],
    callerClass: identity?.callerClass ?? "(unstamped)",
    ref,
    error: connectError.rawMessage,
  });
  // A FRESH error: same code (never changed — SDK retry semantics stay
  // honest), rewritten description + ref, and NO inherited details or
  // metadata (the Java trailers-drop; rethrownStatusError's lesson).
  return new ConnectError(copy + supportRefSuffix(ref), connectError.code);
}
