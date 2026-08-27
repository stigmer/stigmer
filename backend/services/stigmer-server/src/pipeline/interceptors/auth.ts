/**
 * Identity chassis — chain position 1, outermost (reserved by DD-004;
 * filled by O2, 20260827.01, per DD-007 §1). Every request enters the
 * server through exactly one of the two identity sources this module
 * owns, and every request leaves position 1 with a CallerIdentity stashed
 * under `callerIdentityKey`:
 *
 *   - createVerifierChainInterceptor — the serving chain's source: an
 *     ordered claim-or-pass walk over the composed IdentityVerifiers (the
 *     TS rendering of the Java ProviderManager chain).
 *   - createInProcessCallerInterceptor — the in-process router
 *     transport's source: stamps the `internal` caller class (ruling Q4,
 *     the TS rendering of the Java in-process authorization skip).
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
 *   - An ABSENT token falls to trusted-local in both postures. The
 *     require-authentication question for issuer-configured deployments
 *     (and its interplay with is_public methods) is O3's ruling — this
 *     chassis deliberately does not invent it.
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
import type { HandlerContext, Interceptor } from "@connectrpc/connect";

import type { Logger } from "../../boot/logger.js";
import type {
  CallerIdentity,
  IdentityVerifier,
} from "../../extensions/identity.js";
import { internalError } from "../errors.js";
import { operatorIdentitySnapshot } from "../steps/defaults.js";

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
 * or the trusted-local fallback per the strictness contract above.
 * Covers unary AND streams — identity is per-request state, not a
 * unary-pipeline concern like the apiresource kind.
 */
export function createVerifierChainInterceptor(
  verifiers: ReadonlyArray<IdentityVerifier>,
  logger: Logger,
): Interceptor {
  return (next) => async (request) => {
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
    }
    request.contextValues.set(
      callerIdentityKey,
      identity ?? trustedLocalIdentity(),
    );
    return next(request);
  };
}

/**
 * The in-process transport's position-1 identity source: stamps the
 * internal caller class carrying the operator's identity fields, so
 * audit stamps on in-process writes stay byte-identical to the wire
 * lane's (both derive from the same #400 seam). The Authorize step treats
 * the internal class as the in-process authorization skip (ruling Q4).
 */
export function createInProcessCallerInterceptor(): Interceptor {
  return (next) => (request) => {
    request.contextValues.set(callerIdentityKey, {
      ...trustedLocalIdentity(),
      callerClass: "internal",
    });
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
