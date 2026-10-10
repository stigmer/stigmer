/**
 * The runner-credential provider seam. Lives in src/runnerauth beside the
 * OSS implementation it fronts.
 *
 * Mint and verify PER CREDENTIAL LANE, where a lane is an implementation's
 * own token_type vocabulary: OSS defines exactly one
 * (TOKEN_TYPE_EXECUTION_SCOPED, runnerauth.ts); the cloud edition's
 * session/connect/pool lanes stay entirely on its side of the
 * seam. The lane parameter is an open string DELIBERATELY — this
 * contract must neither import cloud vocabulary into OSS nor pretend OSS
 * has lanes it does not.
 *
 * Per-arm fail posture, pinned precisely because the approved docs
 * abbreviate it two different ways ("fail-closed" / "fail-soft") and the
 * real contract is BOTH, per arm:
 *
 *   - verify fails CLOSED: any failure — forged, expired, wrong lane, a
 *     lane the implementation does not provide — throws InvalidTokenError,
 *     and the caller's only correct reaction is to refuse what the token
 *     would have unlocked (the values fetch's posture, oss#535).
 *   - mint on a PROVIDED lane without a signing key throws
 *     MintingDisabledError, which the platform exchange RPC maps to the
 *     presence-based "not minted" response the runner handles — degraded,
 *     not fatal. Minting on a lane the implementation does NOT provide is
 *     a composition bug, not a runtime condition: it throws a plain Error
 *     naming the lane (the loud-fail doctrine).
 *
 * The OSS default (newExecutionScopedRunnerCredentialProvider) adapts
 * RunnerAuthService unchanged — same key ladder, same HS256 tokens, same
 * boot-fatal key posture owned by the composition root. Extensions
 * substitute an implementation through the drivers registry point
 * (extensions/drivers.ts); with none composed, behavior is byte-identical
 * to the direct-service wiring this seam replaced.
 *
 * # The optional capability methods
 *
 * Beyond the mint/verify primitives, an edition's runner credentials
 * surface at four OSS-owned touchpoints whose POLICY is edition-specific:
 * the platform scoped-token exchange, the bootstrap credential response,
 * the token baked into a provisioned sandbox, and the values fetch's
 * trust decision. Each is an OPTIONAL method here; each OSS call
 * site falls back to today's exact behavior when the method is absent,
 * and the OSS default provider defines none of these POLICY capabilities
 * — empty-composition behavior is byte-identical by construction (the
 * local conformance rosters pin it). One provider object carries the
 * edition's whole credential story; the rejected alternative (a second
 * single-instance driver for the exchange) split that story across two
 * objects whose only consumer is the same composition.
 *
 * One capability is open source's OWN and the default provider does
 * define it: `mintRunCredential`, the run credential the dispatch path
 * puts on every invoke workflow input (2026-09-16). It is optional on the
 * seam for the same reason the others are — an edition whose runner
 * credential rides another channel (the cloud's, minted at sandbox
 * provision) leaves it undefined and its payloads carry nothing — but
 * here the OSS default is the one that defines it, because the run
 * credential is how an open-source runner acts for each run under the
 * built-in authorization posture (runner-subject-verifier.ts). A unit
 * that registers its own Authorizer but no provider of its own inherits
 * this mint and composes no verifier for it; such a unit owns its
 * credential story and must bring a provider, the rule the composition
 * root already states for the verifier.
 *
 * Capability implementations REFUSE by throwing (a ConnectError with the
 * implementation's own byte-pinned copy — the gate-step refusal shape)
 * and DEGRADE by returning their not-minted/empty results. The
 * distinction is contract: a refusal fails the RPC, a degrade rides the
 * presence-based response the runner already handles.
 */
import type { CallerIdentity } from "../extensions/identity.js";
import type { MintedToken } from "./runnerauth.js";
import {
  InvalidTokenError,
  RunnerAuthService,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "./runnerauth.js";

/**
 * The domain shape of a getRunnerScopedToken request — one arm per proto
 * scope (server_info.proto), transcribed so implementations never import
 * wire types. The renewal arm is deliberately empty: every renewal
 * parameter comes from the CALLER's verified credential, never the
 * request (the Java exchange's ruled posture).
 */
export type RunnerScopedTokenRequest =
  | { readonly arm: "agent-execution"; readonly executionId: string }
  | { readonly arm: "pool-claim"; readonly sessionId: string }
  | { readonly arm: "renewal" }
  // The proto oneof left unset — carried so implementations own the
  // refusal (the Java exchange answers INVALID_ARGUMENT; OSS's
  // capability-less fallback answers not-minted). Erasing this arm into
  // any other would let a malformed request impersonate that arm's
  // semantics.
  | { readonly arm: "unset" };

/**
 * An exchange outcome: minted, or the presence-based "not minted" shape
 * (empty output on the wire — the runner's degrade contract). Refusals
 * are NOT an arm of this type: implementations throw them.
 */
export type RunnerScopedTokenExchange =
  | { readonly minted: false }
  | {
      readonly minted: true;
      readonly token: string;
      readonly expiresInSeconds: number;
    };

/**
 * The credential portion of a getRunnerBootstrapConfig response. Both
 * arms are independently optional — the Java contract's presence-based
 * coupling (token fields all-or-nothing, key fields all-or-nothing) is
 * expressed structurally.
 */
export interface RunnerBootstrapCredentials {
  readonly accessToken?: {
    readonly token: string;
    readonly expiresInSeconds: number;
  };
  readonly payloadKeys?: {
    readonly keyId: string;
    readonly keyBase64: string;
    readonly secondaryKeyId?: string;
    readonly secondaryKeyBase64?: string;
  };
}

/**
 * What the sandbox ensure steps (steps.ts) and the MCP connect lane
 * (domain/plugin/tools/sandbox.ts) know when they mint the credential
 * baked into a provisioned sandbox. `sessionId` is empty on the connect
 * scope; `callerIdentityId` is empty when the invocation site
 * has no caller (the Java ensure step's null-identity arm, which mints
 * nothing rather than minting unattributed).
 *
 * The connect scope binds `executionId` to one tools listing's synthetic
 * id (domain/plugin/tools/execution-id.ts), whose attempt the listing lane
 * has already recorded for `callerIdentityId`: the runner in a connect
 * sandbox reads the plugin through the proxy with this credential, so it
 * must act as the person who asked for the listing (stigmer/stigmer#1474). An implementation
 * that switches on `scope` handles every arm; a scope it does not know is
 * a refusal, never another scope's token.
 */
export interface SandboxCredentialRequest {
  readonly scope: "session" | "connect";
  readonly sessionId: string;
  readonly executionId: string;
  readonly org: string;
  readonly callerIdentityId: string;
}

/**
 * The memory-capture eligibility answer for one caller
 * (`authorizeMemoryCapture`):
 *
 *   - `no-opinion`: the caller's credential is not one this
 *     implementation classifies — the gate's own eligibility logic
 *     applies unchanged.
 *   - `refuse`: a runner-class credential outside the capture lane —
 *     the gate answers its byte-pinned PERMISSION_DENIED copy.
 *   - `admit`: the session-scoped capture lane. The implementation
 *     hands over the token's own proved claims: the subject the record
 *     belongs to (Java: "the sub IS the human subject the session
 *     belongs to") and the session id provenance is overridden with
 *     (server-proved beats runner-reported). Both are the
 *     implementation's claim vocabulary — OSS never decodes them.
 */
export type MemoryCaptureDecision =
  | { readonly verdict: "no-opinion" }
  | { readonly verdict: "refuse" }
  | {
      readonly verdict: "admit";
      readonly subjectIdentityAccountId: string;
      readonly provedSessionId: string;
    };

/**
 * Mints and verifies runner credentials per lane. Implementations must be
 * stateless-safe for concurrent use (they gate every values fetch and
 * every execution dispatch).
 */
export interface RunnerCredentialProvider {
  /**
   * Whether the implementation can currently mint for the lane — false
   * for lanes it does not provide AND for provided lanes with no signing
   * key. Callers that degrade on "cannot mint" (the plugin tools listing) probe
   * this instead of catching MintingDisabledError.
   */
  isEnabled(lane: string): boolean;
  /**
   * A credential on the given lane bound to `binding` (what the binding
   * identifies is lane vocabulary — OSS's execution_scoped lane binds an
   * execution id). ttlSeconds <= 0 selects the implementation default.
   */
  mint(lane: string, binding: string, ttlSeconds: number): MintedToken;
  /**
   * Verifies a credential against the ONE lane the caller accepts — the
   * caller states its trust decision, the provider enforces it — and
   * returns the binding. ANY failure throws InvalidTokenError.
   */
  verify(lane: string, token: string): string;

  /**
   * The whole getRunnerScopedToken policy: per-arm caller-class gating,
   * authorization, and mint (the cloud edition's exchange).
   * When present, the platform controller delegates EVERY arm here;
   * absent, the controller keeps the OSS behavior (the execution arm
   * mints on the execution_scoped lane; pool-claim/renewal answer
   * not-minted).
   * Refusals throw; keyless degrade returns `{ minted: false }`.
   */
  exchangeScopedToken?(
    request: RunnerScopedTokenRequest,
    caller: CallerIdentity,
  ): Promise<RunnerScopedTokenExchange>;

  /**
   * The credential portion of getRunnerBootstrapConfig (the runner access
   * token and per-identity payload-encryption keys). When present, the
   * platform controller merges the result into the response; absent, the
   * fields stay empty (the OSS posture — minting a proxy credential is a
   * cloud capability). Both arms are best-effort by contract: a failure
   * inside an arm degrades that arm to absent, never fails the bootstrap
   * the Temporal coordinates ride on.
   */
  bootstrapCredentials?(
    caller: CallerIdentity,
  ): Promise<RunnerBootstrapCredentials>;

  /**
   * The credential baked into a provisioned sandbox (SandboxEnvironment.
   * stigmerToken). When present, the ensure steps and the connect lane
   * delegate here with the full provisioning context; absent, they mint
   * on the execution_scoped lane exactly as before. Returns "" to launch tokenless (the
   * redaction-fallback contract lane.ts documents); a thrown error
   * propagates to the invoking step's own failure posture.
   */
  mintSandboxCredential?(request: SandboxCredentialRequest): string;

  /**
   * The RUN credential the dispatch path hands the runner in the invoke
   * workflow input (`execution_context_token` — the connect lane's key
   * for the same token type). Bound to one execution and carrying NO
   * `exp`: its validity is the bound row's liveness (runnerauth.ts
   * `mintRunCredential`; bound-execution.ts), read by both lanes that
   * accept it. When present, the engine client calls it for every
   * dispatch (start and recover); absent,
   * the payload carries no credential — the edition's runner is
   * credentialed another way (the cloud bakes a sandbox credential at
   * provision). Returns "" to dispatch without a credential (the lane
   * cannot mint — keyless); a thrown error is a real fault, which the
   * dispatch reader (dispatch-credential.ts) logs and degrades to the
   * same "" rather than failing the run's start.
   */
  mintRunCredential?(executionId: string): string;

  /**
   * The trust decision for VaultValueController.fetchValues: whether the
   * bearer may read the values of `executionId` (a run's id or a tool
   * connect's attempt id). When present, it decides whose credential this
   * is — the implementation owns its lane set and scope bindings (the
   * cloud's session/connect scope rules, including any resource loads
   * through its own clients) — and the fetch still requires the bound
   * execution to be live after it (a run not ended past the grace, a
   * connect's attempt present); absent, the fetch keeps the OSS decision
   * (execution_scoped verify, binding equality and that liveness). True
   * allows; false refuses with PERMISSION_DENIED; it never throws for an
   * unrecognized or invalid token (a throw is a composition fault, logged
   * and refused the same way).
   */
  authorizeExecutionValuesRead?(
    rawToken: string,
    executionId: string,
  ): Promise<boolean>;

  /**
   * Decrypt-key material for a Temporal payload-encryption key id the
   * server's env-configured codec does not hold (the server-managed
   * per-identity `rpk_` keys bootstrapCredentials hands
   * out — resolution belongs on the same object that distributes them).
   * Threaded into the server's decode-only payload codec at compose;
   * consulted only when that codec is installed at all (env-keyed — the
   * cloud composition always configures the platform key). Undefined
   * means unknown: the codec keeps its pinned fail-closed throw. Absent
   * method → today's exact behavior (static env keys only).
   */
  resolvePayloadKey?(keyId: string): Promise<Buffer | undefined>;

  /**
   * The memory capture-eligibility decision for one caller (an edition
   * may admit its session-sandbox credential and refuse every other
   * runner credential). Consulted by GuardMemoryCapture
   * BEFORE its own eligibility logic; `no-opinion` falls through to
   * that logic unchanged. REFUSES the org-mismatch arm by throwing a
   * ConnectError with the implementation's byte-pinned copy (Java:
   * "a mismatch is a forged address, not a routing choice" —
   * `captureOrg` is the request's metadata.org, checked against the
   * token's own org claim).
   *
   * May answer synchronously or with a promise: the cloud's credential
   * carries the subject and the session in its own claims, so its answer
   * is a decode; open source's run credential names only the execution,
   * so the built-in provider reads the execution row for its session and
   * org (built-in-runner-credential-provider.ts). The gate awaits either.
   *
   * Absent method → the gate's existing logic exactly (today's OSS
   * behavior: the trusted-local single-user posture admits, honestly).
   */
  authorizeMemoryCapture?(
    caller: CallerIdentity,
    captureOrg: string,
  ): MemoryCaptureDecision | Promise<MemoryCaptureDecision>;
}

/**
 * The OSS default: RunnerAuthService behind the provider contract,
 * providing only the execution_scoped lane, plus the one capability that
 * is open source's own — the run credential a dispatch carries (module
 * header). A separate adapter rather than the service implementing the
 * interface: the service's concrete lane-free signatures are a stable
 * test surface.
 */
export function newExecutionScopedRunnerCredentialProvider(
  service: RunnerAuthService,
): RunnerCredentialProvider {
  return {
    isEnabled(lane: string): boolean {
      return lane === TOKEN_TYPE_EXECUTION_SCOPED && service.isEnabled();
    },
    mint(lane: string, binding: string, ttlSeconds: number): MintedToken {
      if (lane !== TOKEN_TYPE_EXECUTION_SCOPED) {
        throw new Error(
          `runner credential lane '${lane}' is not provided by this implementation (provides '${TOKEN_TYPE_EXECUTION_SCOPED}')`,
        );
      }
      return service.mint(binding, ttlSeconds);
    },
    verify(lane: string, token: string): string {
      if (lane !== TOKEN_TYPE_EXECUTION_SCOPED) {
        throw new InvalidTokenError();
      }
      return service.verify(token);
    },
    mintRunCredential(executionId: string): string {
      // Keyless is the modeled disabled state (the exchange's fail-soft
      // arm, the sandbox lane's tokenless launch): answer "" and let the
      // dispatch go without. Anything else the service refuses is a
      // programming error and propagates as itself.
      if (!service.isEnabled()) {
        return "";
      }
      return service.mintRunCredential(executionId);
    },
  };
}
