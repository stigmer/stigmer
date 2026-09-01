/**
 * The post-authentication caller-guard seam (convergence entry
 * 20260902.02, gate ruling Q1) — enforcement of the MINTING CLIENT's
 * contract, run by the serving chassis after the position-1 identity
 * stamp. The TS rendering of the cloud Java
 * PlatformClientEnforcementInterceptor's home: verification says who the
 * caller IS (the IdentityVerifier chain, deliberately token-only); a
 * guard says whether the client that minted the credential may still be
 * served (deletion-revocation liveness, cloud#342; Origin vs
 * allowed_origins, oss#375). Java separates the two classes the same way.
 *
 * List point — guards concatenate in unit order and run in composed
 * order; the first throw wins. OSS composes zero guards, so with none
 * registered the serving chain behaves byte-identically to before the
 * point existed (the conformance rosters pin that).
 *
 * The in-process exemption is STRUCTURAL, not policed: guards are a
 * parameter of the serving chain's identity source only
 * (createVerifierChainInterceptor); the in-process interceptor has no
 * guard parameter to forget — the TS rendering of the Java
 * InProcessCallContextHolder skip.
 *
 * Skip logic is the guard's own business. OSS runs every composed guard
 * on every serving request with the FINAL stamped identity (claimed or
 * trusted-local): which tokens a guard exempts (claim-less tokens, the
 * load-bearing token_type skip, health/reflection services) is edition
 * policy, decoded by the guard from CallerIdentity.rawToken — never OSS
 * type widening (the O5 Q4 vocabulary doctrine).
 *
 * Fault doctrine (the verifier-chain doctrine applied to admission): a
 * guard that REFUSES throws a ConnectError — its own wire mapping, and
 * deliberate-refusal codes pass the position-0 error boundary untouched,
 * so byte-pinned refusal copy survives to the wire. Any other throw is
 * an infrastructure fault — INTERNAL, never softened into a denial (a
 * store outage during a liveness read must not read as "client
 * deleted"). The chassis logs both arms with the guard's name: position
 * 1 sits outside the logging interceptor, so a guard's refusal would
 * otherwise leave no operator record.
 */
import type { DescMethod } from "@bufbuild/protobuf";

import type { CallerIdentity } from "./identity.js";

export interface CallerGuard {
  /** Names the guard in refusal and fault logs (e.g. 'platform-client'). */
  readonly name: string;
  /**
   * Admits by returning; refuses by throwing a ConnectError (the guard's
   * own wire mapping). Runs on unary AND stream calls, once per call at
   * admission, before the handler and before validation. `method` carries
   * its parent service descriptor (service-level skips need no extra
   * parameter); `headers` is the request's wire metadata (the Origin
   * check reads the plain lowercase `origin` key, the verified
   * guest-mint-lane idiom).
   */
  guard(
    caller: CallerIdentity,
    method: DescMethod,
    headers: Headers,
  ): Promise<void>;
}
