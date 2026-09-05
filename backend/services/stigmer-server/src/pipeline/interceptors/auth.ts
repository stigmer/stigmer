/**
 * Identity chassis — chain position 1, outermost (reserved by DD-004;
 * filled by O2, 20260827.01, per DD-007 §1). Every request enters the
 * server through exactly one of the two identity sources this module
 * owns, and every request leaves position 1 with a CallerIdentity stashed
 * under `callerIdentityKey`:
 *
 *   - createVerifierChainInterceptor — the serving chain's source: an
 *     ordered claim-or-pass walk over the composed IdentityVerifiers (the
 *     TS rendering of the Java ProviderManager chain), followed by the
 *     composed CallerGuards over the stamped identity (entry 20260902.02
 *     ruling Q1 — see extensions/caller-guards.ts for the contract and
 *     its doctrine).
 *   - createInProcessCallerInterceptor — the in-process router
 *     transport's source: stamps the `internal` caller class (ruling Q4,
 *     the TS rendering of the Java in-process authorization skip). It
 *     takes NO guards — the in-process exemption is structural
 *     (caller-guards.ts), not a runtime skip.
 *
 * The internal class is mintable ONLY here, only by the in-process
 * interceptor: the serving chain always overwrites the position-1 value
 * from the wire, contextValues never cross a transport, and no
 * IdentityVerifier may produce the class (contract on CallerClass).
 * Spoofing is structurally impossible, not policed.
 *
 * # Conditional strictness (ruling Q6 — pinned contract)
 *
 * Strictness is a function of whether any verifier is configured:
 *
 *   - ZERO verifiers (every shipped OSS composition today): a presented
 *     token that nothing claims falls through SILENTLY to the
 *     trusted-local identity. This preserves wire behavior byte-for-byte
 *     — the runner presents a Bearer token on every control-plane RPC
 *     when STIGMER_TOKEN is set, and domains that verify tokens (the
 *     executioncontext decrypt lane) read the raw header themselves.
 *   - ONE OR MORE verifiers: a presented-but-unclaimed token is
 *     UNAUTHENTICATED. A configured issuer must never silently admit
 *     garbage tokens as trusted-local.
 *   - An ABSENT token falls to trusted-local UNLESS the composition asks
 *     for the require-authentication posture (O3 rulings Q1+Q2,
 *     20260827.06): with requireAuthentication on — compose.ts sets it
 *     when STIGMER_OIDC_ISSUER is configured OR when a composed extension
 *     unit declares `requireAuthentication` (entry 20260904.02, the
 *     cloud's ask: its own lanes resolve its users, and the issuer knob
 *     cannot stand in because it also registers the OSS OIDC verifier
 *     ahead of them; the OSS API-key lane, by contrast, rides EITHER
 *     posture source — stigmer#984) — a tokenless request is
 *     UNAUTHENTICATED "authentication token missing" (the Java
 *     interceptor's byte-pinned copy), EXCEPT where isAuthenticationExempt
 *     says so: is_public-marked methods (the Java isPublic skip) and the
 *     gRPC health service by name (the Java by-name skip — a third-party
 *     proto cannot carry our option, and a Kubernetes `grpc:` probe is a
 *     tokenless Health/Check; without this arm the posture crash-loops the
 *     pod, stigmer#974). Extension-only verifier sets that declare
 *     nothing keep the fall-to-trusted-local arm: strictness against
 *     PRESENTED tokens is a function of verifier count (Q6); strictness
 *     against ABSENT tokens is the composition's explicit ask.
 *
 * # Trusted-local identity (the explicit modeled state)
 *
 * No issuer + no claim = the single-operator trust domain's one
 * principal, minted from the #400 operator seam (steps/defaults.ts):
 * identityId is the operator email (email-first, matching the audit
 * doctrine there), or "system" when unconfigured. The audit-actor seam
 * derives from this identity the exact bytes currentAuditActor stamped
 * before O2.
 *
 * # Verifier faults
 *
 * A verifier that throws a ConnectError chose its wire shape (signature/
 * expiry/audience failures are UNAUTHENTICATED by the verifier's own
 * mapping); any other throw is an infrastructure fault — INTERNAL, never
 * softened into an auth denial (the DD-007 unavailable doctrine, applied
 * to the verification side).
 */
import { Code, ConnectError, createContextKey } from "@connectrpc/connect";
import type {
  HandlerContext,
  Interceptor,
  StreamRequest,
  UnaryRequest,
} from "@connectrpc/connect";
import { getOption } from "@bufbuild/protobuf";
import type { DescMethod } from "@bufbuild/protobuf";

import { is_public } from "@stigmer/protos/ai/stigmer/commons/rpc/method_options_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerGuard } from "../../extensions/caller-guards.js";
import type {
  CallerIdentity,
  IdentityVerifier,
} from "../../extensions/identity.js";
import { internalError } from "../errors.js";
import { operatorIdentitySnapshot } from "../steps/defaults.js";

/**
 * The tokenless-request refusal under the require-authentication posture —
 * the Java interceptor's copy (GrpcSecurityConfigBase), byte-pinned.
 */
export const AUTHENTICATION_TOKEN_MISSING_MESSAGE =
  "authentication token missing";

/**
 * Services reachable WITHOUT a credential under the require-authentication
 * posture, by fully-qualified service name — the Java interceptor's
 * by-name skip list (GrpcSecurityConfigBase), for services whose protos
 * are not ours and so cannot carry the `is_public` method option. The
 * standard gRPC health service is the one entry OSS serves: Kubernetes
 * `grpc:` probes call Health/Check tokenless, and a refused probe is a
 * pod that never becomes Ready (stigmer#974). Java's second entry,
 * `grpc.reflection.v1alpha.ServerReflection`, is deliberately absent —
 * OSS registers no reflection service; a future registration joins this
 * set in the same change, or the posture refuses it.
 */
export const AUTHENTICATION_EXEMPT_SERVICES: ReadonlySet<string> = new Set([
  "grpc.health.v1.Health",
]);

/**
 * Whether a method stays reachable tokenless under the
 * require-authentication posture: `is_public` on the method (our protos)
 * or an exempt service by name (third-party protos). The ONE predicate
 * the refusal arm consults, so both exemption doctrines read as a single
 * decision and are pinned together.
 */
export function isAuthenticationExempt(method: DescMethod): boolean {
  return (
    getOption(method, is_public) ||
    AUTHENTICATION_EXEMPT_SERVICES.has(method.parent.typeName)
  );
}

/**
 * Context key for the request's caller identity. The default is
 * `undefined` so a read BEFORE position 1 has stamped (a wiring bug — both
 * chains stamp unconditionally) is loud through callerIdentityOf, never a
 * silent placeholder principal.
 */
export const callerIdentityKey = createContextKey<CallerIdentity | undefined>(
  undefined,
  { description: "caller identity produced at chain position 1" },
);

/**
 * The request's caller identity — the ONE read idiom for controllers
 * (threaded into RequestContext exactly once, ruling Q3). Throws the
 * composition-root wiring fault when position 1 did not stamp: that state
 * is unreachable through either chain, so reaching it means a transport
 * was built without an identity source.
 */
export function callerIdentityOf(ctx: HandlerContext): CallerIdentity {
  const identity = ctx.values.get(callerIdentityKey);
  if (identity === undefined) {
    throw internalError(
      new Error("no caller identity in context (chain wiring bug)"),
      "internal server error",
    );
  }
  return identity;
}

/**
 * The trusted-local single-user identity — the explicit modeled state for
 * "no verifier claimed this request". Read per request (not cached at
 * chain build) so composeServer stays re-entrant for tests while the
 * operator seam remains process-global.
 */
export function trustedLocalIdentity(): CallerIdentity {
  const operator = operatorIdentitySnapshot();
  if (operator.email === "") {
    return {
      identityId: "system",
      callerClass: "user",
      issuer: "",
      rawToken: "",
    };
  }
  return {
    identityId: operator.email,
    callerClass: "user",
    issuer: "",
    rawToken: "",
    email: operator.email,
    displayName: operator.displayName,
  };
}

/**
 * The serving chain's position-1 identity source: walks the composed
 * verifiers in order (OSS entries first, extension entries after, in
 * extension-unit order — registry contract), stamps the claimed identity
 * or the trusted-local fallback per the strictness contract above, then
 * runs the composed caller guards over the stamped identity (entry
 * 20260902.02 ruling Q1). Covers unary AND streams — identity is
 * per-request state, not a unary-pipeline concern like the apiresource
 * kind.
 *
 * `guards` is REQUIRED, like the identity source on buildInterceptorChain:
 * a serving transport that forgets its guards must be a compile error,
 * never a silently unenforced edge — the exact failure class this seam
 * exists to close (the cloud's platform-client controls went unported
 * through five green readouts because nothing forced them).
 */
export function createVerifierChainInterceptor(
  verifiers: ReadonlyArray<IdentityVerifier>,
  guards: ReadonlyArray<CallerGuard>,
  logger: Logger,
  requireAuthentication = false,
): Interceptor {
  return (next) => async (request) => {
    // The in-process propagation header is meaningless — and forgeable —
    // on the wire: stripped unconditionally before anything downstream
    // could read it (ruling R5's unspoofability-by-construction arm).
    request.header.delete(IN_PROCESS_CALLER_HEADER);
    const token = parseBearerToken(request.header.get("authorization") ?? "");
    let identity: CallerIdentity | undefined;
    if (token !== "") {
      identity = await runVerifierChain(verifiers, token, logger);
      if (identity === undefined && verifiers.length > 0) {
        // Position 1 is outside the logging interceptor, so the rejection
        // is recorded here (the wire carries only the sanitized copy).
        logger.warn("presented token not claimed by any identity verifier", {
          verifiers: verifiers.map((v) => v.name).join(", "),
        });
        throw new ConnectError(
          "the presented token was not accepted by any configured identity verifier",
          Code.Unauthenticated,
        );
      }
    } else if (
      requireAuthentication &&
      !isAuthenticationExempt(request.method)
    ) {
      // Rulings Q1+Q2: the auth-enabled posture requires a credential on
      // every non-exempt method — the Java interceptor's exact behavior
      // and copy. is_public methods and the health service stay reachable
      // tokenless (the Java isPublic and by-name skips), so the console's
      // anonymous reads and the pod's probes survive.
      throw new ConnectError(
        AUTHENTICATION_TOKEN_MISSING_MESSAGE,
        Code.Unauthenticated,
      );
    }
    const stamped = identity ?? trustedLocalIdentity();
    request.contextValues.set(callerIdentityKey, stamped);
    await runCallerGuards(guards, stamped, request, logger);
    return next(request);
  };
}

/**
 * The composed-order guard walk (caller-guards.ts contract): every guard
 * runs against the FINAL stamped identity; the first throw wins. A
 * ConnectError is the guard's own wire mapping; any other throw is an
 * infrastructure fault (INTERNAL — a store outage during a liveness read
 * must never read as an admission refusal). Both arms are recorded here:
 * position 1 sits outside the logging interceptor, so this is a guard
 * outcome's only operator record (the verifier-rejection precedent
 * above).
 */
async function runCallerGuards(
  guards: ReadonlyArray<CallerGuard>,
  caller: CallerIdentity,
  request: UnaryRequest | StreamRequest,
  logger: Logger,
): Promise<void> {
  for (const guard of guards) {
    try {
      await guard.guard(caller, request.method, request.header);
    } catch (error) {
      const procedure = `/${request.service.typeName}/${request.method.name}`;
      if (error instanceof ConnectError) {
        logger.warn("caller guard refused the request", {
          guard: guard.name,
          procedure,
          code: Code[error.code],
        });
        throw error;
      }
      logger.error("caller guard failed", {
        guard: guard.name,
        procedure,
        error: error instanceof Error ? error.message : String(error),
      });
      throw internalError(error, "internal server error");
    }
  }
}

/**
 * The caller-propagation header of the in-process lane (C2 Stage 3,
 * ruling R5). Client CallOptions carry no contextValues across the
 * router transport, so the asCaller adapters (boot/inprocess.ts) ride
 * the one channel that does cross it: a request header, base64url JSON.
 * Unspoofable from the wire BY CONSTRUCTION: the serving chassis strips
 * it before anything can read it, and only the in-process interceptor —
 * reachable only by server code — honors it.
 */
export const IN_PROCESS_CALLER_HEADER = "x-stigmer-inprocess-caller";

/** Encodes a CallerIdentity for the propagation header. */
export function encodeInProcessCaller(caller: CallerIdentity): string {
  return Buffer.from(JSON.stringify(caller)).toString("base64url");
}

/**
 * The in-process transport's position-1 identity source. Two arms since
 * C2 Stage 3 (ruling R5 — the caller-propagation amendment restoring the
 * Java posture, where in-process calls carried the ORIGINAL caller):
 *
 *   - PROPAGATED: a request-origin adapter passed the original caller's
 *     identity through {@link IN_PROCESS_CALLER_HEADER} (the asCaller
 *     edges) — it forwards with `origin: "in-process"` stamped, so
 *     attribution (owner/creator tuples, audit) lands on the real user
 *     while transport-trust arms (the reserved-label guard) still see
 *     the server-composed origin.
 *   - MINTED: no propagated identity — the daemon-origin default (the
 *     schedule clock, the project reconciler): the internal caller class
 *     carrying the operator's identity fields, so audit stamps on
 *     daemon writes stay byte-identical to the pre-R5 posture. The
 *     Authorize step treats the internal class as the in-process
 *     authorization skip (ruling Q4).
 *
 * A malformed propagation header is a WIRING BUG (only server code can
 * write it) — loud INTERNAL, never a silent fall-through to a wrong
 * identity.
 */
export function createInProcessCallerInterceptor(): Interceptor {
  return (next) => (request) => {
    const encoded = request.header.get(IN_PROCESS_CALLER_HEADER);
    let identity: CallerIdentity;
    if (encoded !== null) {
      request.header.delete(IN_PROCESS_CALLER_HEADER);
      try {
        identity = {
          ...(JSON.parse(
            Buffer.from(encoded, "base64url").toString("utf8"),
          ) as CallerIdentity),
          origin: "in-process",
        };
      } catch (error) {
        throw internalError(
          error instanceof Error ? error : new Error(String(error)),
          "internal server error",
        );
      }
    } else {
      identity = {
        ...trustedLocalIdentity(),
        callerClass: "internal",
        origin: "in-process",
      };
    }
    request.contextValues.set(callerIdentityKey, identity);
    return next(request);
  };
}

/**
 * The claim-or-pass walk (identity.ts contract): a claim wins, null moves
 * to the next verifier, a ConnectError throw is the verifier's own wire
 * mapping, any other throw is an infrastructure fault (INTERNAL — a JWKS
 * outage must never read as a credential rejection).
 */
async function runVerifierChain(
  verifiers: ReadonlyArray<IdentityVerifier>,
  token: string,
  logger: Logger,
): Promise<CallerIdentity | undefined> {
  for (const verifier of verifiers) {
    let claimed: CallerIdentity | null;
    try {
      claimed = await verifier.verify(token);
    } catch (error) {
      if (error instanceof ConnectError) {
        throw error;
      }
      logger.error("identity verifier failed", {
        verifier: verifier.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw internalError(error, "internal server error");
    }
    if (claimed !== null) {
      return claimed;
    }
  }
  return undefined;
}

/**
 * The Bearer credential from a (possibly comma-joined) authorization
 * header value; empty when absent or differently shaped. One shared
 * definition of the shape both consumers use (this chassis and the
 * executioncontext decrypt lane): case-insensitive "bearer " prefix, the
 * remainder non-empty before trimming. Node's http2 layer joins repeated
 * headers with ", " — the first comma segment IS the first value, and a
 * genuine token (base64url segments joined by dots) can never contain a
 * comma, so the split is lossless for every legitimate shape (the Go
 * server read metadata values[0], same result).
 */
export function parseBearerToken(joinedHeaderValue: string): string {
  const header = joinedHeaderValue.split(",")[0] ?? "";
  const prefix = "bearer ";
  if (
    header.length <= prefix.length ||
    header.slice(0, prefix.length).toLowerCase() !== prefix
  ) {
    return "";
  }
  return header.slice(prefix.length).trim();
}
