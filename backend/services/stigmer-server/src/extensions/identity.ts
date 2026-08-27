/**
 * Identity extension-point types — the verifier-chain contract of the
 * convergence blueprint (20260826.02 blueprint/03 §4, DD-007), carried by
 * the extension registry from O1 (20260826.09) and CONSUMED by O2, which
 * turns the pass-through auth interceptor into the ordered verifier chain.
 *
 * The shapes are transcribed from the ratified design, not invented here:
 * a verifier either CLAIMS a token (verifying it fully, throwing on
 * signature/expiry/audience failure) or PASSES (returns null → next
 * verifier) — the TS rendering of the Java ProviderManager chain. The
 * product is one typed value, CallerIdentity, threaded explicitly through
 * HandlerContext.values (never ambient state — the every-dependency-
 * explicit doctrine).
 */

/**
 * The caller-class discriminant. OSS knows user / machine / runner; the
 * cloud composition extends the vocabulary (guest / channel / schedule)
 * without an OSS enum change — hence the open string arm. `string & {}`
 * keeps literal autocomplete while admitting extension values (a plain
 * `string` would erase the known classes from the type surface).
 */
export type CallerClass = "user" | "machine" | "runner" | (string & {});

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
