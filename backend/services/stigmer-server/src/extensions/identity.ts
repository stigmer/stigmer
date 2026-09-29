/**
 * Identity extension-point types — the verifier-chain contract of the
 * convergence blueprint (20260826.02 blueprint/03 §4, DD-007), carried by
 * the extension registry from O1 (20260826.09) and consumed by the
 * verifier-chain chassis (O2, 20260827.01 — pipeline/interceptors/auth.ts).
 *
 * The shapes are transcribed from the ratified design, not invented here:
 * a verifier either CLAIMS a token (verifying it fully, throwing on
 * signature/expiry/audience failure) or PASSES (returns null → next
 * verifier) — the TS rendering of the Java ProviderManager chain. The
 * product is one typed value, CallerIdentity, threaded explicitly through
 * HandlerContext.values (never ambient state — the every-dependency-
 * explicit doctrine).
 */
import { USER_TOKEN_CLAIMS } from "../domain/platformclient/constants.js";
import {
  decodeVerifiedPlatformTokenPayload,
  stringClaim,
} from "../platformtoken/envelope.js";

/**
 * The caller-class discriminant. OSS knows user / machine / runner plus
 * the in-process `internal` class (O2 ruling Q4: the TS rendering of the
 * Java in-process authorization skip); the cloud composition extends the
 * vocabulary (guest / channel / schedule) without an OSS enum change —
 * hence the open string arm. `string & {}` keeps literal autocomplete
 * while admitting extension values (a plain `string` would erase the
 * known classes from the type surface).
 *
 * `internal` is ratified contract with a structural guarantee: it is
 * minted ONLY by server code, in pipeline/interceptors/auth.ts — the
 * in-process chain's identity interceptor (boot/inprocess.ts) and
 * `serverActingFor`, the server acting for a principal it authenticated
 * itself (the PlatformClient mint). No IdentityVerifier may produce it —
 * the serving chain always overwrites the position-1 identity from the
 * wire, so a spoofed internal class cannot enter through a transport.
 */
export type CallerClass =
  | "user"
  | "machine"
  | "runner"
  | "internal"
  | (string & {});

/**
 * How the request reached the chain — the transport-trust discriminant
 * the reserved-label guard keys on (C2 Stage 3, ruling R5; the TS
 * rendering of the Java isInProcessCall arm, cloud#386). `in-process` is
 * stamped ONLY by the in-process chain's identity interceptor — only
 * server code can reach that transport, so the marker is unspoofable —
 * and it survives caller PROPAGATION: a request-origin in-process call
 * carries the ORIGINAL caller's identity with this origin, letting the
 * server compose requests as the user (default-instance factories,
 * managed environments) without those requests being mistaken for
 * client-boundary writes. Absent means the wire.
 */
export type CallOrigin = "wire" | "in-process";

/**
 * The authenticated caller, produced by the verifier chain and read by the
 * Authorizer and the audit-actor seam. Org membership is DELIBERATELY not
 * carried (blueprint §4b): it is authorization data, resolved by the
 * Authorizer per check, never cached on the identity.
 */
export interface CallerIdentity {
  /** The principal the Authorizer sees (e.g. an identity-account id). */
  readonly identityId: string;
  readonly callerClass: CallerClass;
  /** The issuer that vouched for the token (empty for local postures). */
  readonly issuer: string;
  /** The raw presented token, carried for downstream propagation. */
  readonly rawToken: string;
  /**
   * Optional display identity for the audit-actor seam (O2 ruling Q5, the
   * ratified DD-007 amendment): OIDC-class verifiers carry the caller's
   * email/name claims here; the trusted-local identity carries the #400
   * operator identity. Absent on identities whose issuer provides no
   * display claims — the audit actor then falls back to identityId alone.
   */
  readonly email?: string;
  readonly displayName?: string;
  /**
   * The PlatformClient whose minted user token this caller presented,
   * carried for the audit-actor seam as `email` and `displayName` are:
   * the audit actor records it (ApiResourceAuditActor.platform_client_id),
   * and that server-owned record is what later readers key on, never this
   * field (stigmer/stigmer#1256). Set ONLY by the PlatformClient
   * user-token verifier (domain/platformclient/verifier.ts), from the
   * claim it has just verified and whose client it has just found alive;
   * absent on every other credential. It is provenance, not authorization
   * data (the account the token names is still the principal), and not a
   * guard vocabulary: caller guards decode their own skip logic from
   * `rawToken` (extensions/caller-guards.ts).
   */
  readonly platformClientId?: string;
  /**
   * The transport the request entered through (C2 Stage 3, ruling R5).
   * Absent = the wire; the in-process interceptor stamps `in-process` on
   * every identity it forwards — minted internal AND propagated caller
   * alike.
   */
  readonly origin?: CallOrigin;
}

/**
 * One entry in the ordered token-verifier chain (claim-or-pass semantics,
 * blueprint §4a). Order is composition order: OSS entries first, extension
 * entries after, in extension-unit order.
 */
export interface IdentityVerifier {
  /** Names the verifier in boot logs and auth failures (e.g. 'oidc'). */
  readonly name: string;
  /**
   * Claims the token (returns the identity), passes (returns null so the
   * next verifier runs), or throws — a verifier that RECOGNIZES a token
   * but cannot verify it must throw, never pass (a pass would let a forged
   * token fall through to a laxer verifier).
   */
  verify(token: string): Promise<CallerIdentity | null>;
}

/**
 * Whether `caller` is one of the platform's own pipelines — the admission
 * rule of the RPCs a person must never reach directly, stated ONCE
 * (20260911.11 A7 for the identity-account `create` RPC; 20260913.01
 * Q-OR-7 and Q-S5-10 for the three IamPolicy system RPCs): a `machine`
 * account (the platform's service accounts), the `internal` class (the
 * server acting as itself over the in-process transport) or ANY identity
 * that entered through that transport (a propagated user the server is
 * composing a request for). A wire `user`, a `runner` and a composition's
 * own classes are refused by the RPC that reads this — under the
 * permissive Authorizer the annotation alone would admit anyone, so the
 * rule is load-bearing in open source.
 */
export function isPlatformPipelineCaller(caller: CallerIdentity): boolean {
  return caller.callerClass === "machine" || isServerComposedRequest(caller);
}

/**
 * Whether the request `caller` arrived on was composed by the server's own
 * code rather than presented on the wire: the `internal` class (the server
 * acting as itself) or ANY identity that entered through the in-process
 * transport (a propagated person the server is building a request for,
 * such as the default-instance self-heal that creates as the run's human
 * for attribution). The serving chassis strips the propagation header, so
 * the wire cannot claim this.
 *
 * This is the trust arm the label guard, the memory-capture gate and the
 * execution-context create check share: what a server-composed request
 * carries was decided by the service code that built it, and the
 * entry-point request already passed its own gate. It is NARROWER than
 * `isPlatformPipelineCaller`: a wire `machine` account is one of the
 * platform's pipelines but its request is still the wire's, so a step
 * that trusts server-composed state (a reserved label, a default
 * instance's provenance) must key on this predicate and never on that one.
 */
export function isServerComposedRequest(caller: CallerIdentity): boolean {
  return caller.callerClass === "internal" || caller.origin === "in-process";
}

/**
 * Whether `caller` is a FIRST-PARTY HUMAN OPERATOR: a person at the
 * console, the CLI or an SDK, speaking for themselves on the wire — the
 * TS rendering of the Java RequestCallerIdentity.isFirstPartyHumanOperator
 * (not machine, not impersonated, no token_type, not a PlatformClient user
 * token). Stated once for every consumer that must tell the person from a
 * lane acting near them: memory recall and the person's declared
 * preferences on execution create (domain/agentexecution/create-steps.ts),
 * and memory capture's fall-through for a credential the composed runner
 * provider does not classify (pipeline/steps/guard-memory-capture.ts), so
 * both halves of the memory loop admit the same people (stigmer#1406).
 *
 * An ALLOW-list, so a lane this module has never heard of is excluded by
 * construction: the class must be `user` (every human verifier stamps it —
 * OIDC, API key, the cloud's direct and federated logins; runners, the
 * cloud's token lanes and the platform's own pipelines each carry their
 * own class), the request must come from the wire (the open-source
 * schedule fire acts as its creator with class `user` but rides the
 * in-process transport, which is exactly what `isServerComposedRequest`
 * reads), and the bearer must not be a PlatformClient user token (a
 * person, but spoken for by a third-party client — DD-002 D4 as amended).
 */
export function isFirstPartyHumanOperator(caller: CallerIdentity): boolean {
  return (
    caller.callerClass === "user" &&
    !isServerComposedRequest(caller) &&
    !carriesPlatformClientClaim(caller.rawToken)
  );
}

/**
 * Whether the bearer is a platform token naming a PlatformClient. Anything
 * that is not a platform token (no token, an API key, another issuer's
 * JWT) is not one, whatever claims it carries (stigmer#1312). Read from
 * the raw token, never from `platformClientId`, which is audit provenance
 * set by one verifier and not a guard vocabulary (see its field doc).
 */
export function carriesPlatformClientClaim(rawToken: string): boolean {
  const payload = decodeVerifiedPlatformTokenPayload(rawToken);
  return (
    payload !== undefined &&
    stringClaim(payload, USER_TOKEN_CLAIMS.platformClientId) !== undefined
  );
}
