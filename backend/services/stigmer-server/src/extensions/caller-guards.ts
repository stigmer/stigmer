/**
 * The post-authentication caller-guard seam — enforcement of the MINTER's
 * contract, run by the serving chassis after the position-1 identity
 * stamp: verification says who the caller IS (the IdentityVerifier chain,
 * deliberately token-only); a guard says whether a request bearing the
 * credential may be served from where it came (Origin vs the minting
 * organization's allowed_origins, oss#375).
 *
 * List point — guards concatenate in unit order and run in composed
 * order; the first throw wins. Open source's own guards run first (the
 * verifier list's "OSS entries first" rule): today the embedding origin
 * guard (domain/token/origin-guard.ts), composed only under an
 * authentication posture, where minted user tokens exist. Liveness is not
 * a guard in open source: the user-token verifier refuses a token whose
 * minting service account is gone itself, so verifier-only lanes (the
 * extension HTTP edges) refuse them too. With no posture and no unit
 * guards, the serving chain runs no guard at all.
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
 * type widening (OSS types never grow an edition's vocabulary).
 *
 * Fault mapping (the verifier chain's rule applied to admission): a
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
  /** Names the guard in refusal and fault logs (e.g. 'embedding-origin'). */
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
