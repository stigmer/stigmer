/**
 * The runner-credential provider seam — convergence program 20260826.02,
 * blueprint/03 §6c, extracted with O5 (20260827.02). Lives in
 * src/runnerauth beside the OSS implementation it fronts.
 *
 * Mint and verify PER CREDENTIAL LANE, where a lane is an implementation's
 * own token_type vocabulary: OSS defines exactly one
 * (TOKEN_TYPE_EXECUTION_SCOPED, runnerauth.ts); the cloud edition's
 * session/workflow/connect/pool lanes stay entirely on its side of the
 * seam (C4). The lane parameter is an open string DELIBERATELY — this
 * contract must neither import cloud vocabulary into OSS nor pretend OSS
 * has lanes it does not (the Q4 gate ruling).
 *
 * Per-arm fail posture, pinned precisely because the approved docs
 * abbreviate it two different ways ("fail-closed" / "fail-soft") and the
 * real contract is BOTH, per arm:
 *
 *   - verify fails CLOSED: any failure — forged, expired, wrong lane, a
 *     lane the implementation does not provide — throws InvalidTokenError,
 *     and the caller's only correct reaction is to fall back to redaction
 *     (the executioncontext decrypt lane's posture, oss#535).
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
 * # The optional capability methods (C4, 20260827.09 — gate ruling Q1)
 *
 * Beyond the mint/verify primitives, an edition's runner credentials
 * surface at four OSS-owned touchpoints whose POLICY is edition-specific:
 * the platform scoped-token exchange, the bootstrap credential response,
 * the token baked into a provisioned sandbox, and the ExecutionContext
 * decrypt trust decision. Each is an OPTIONAL method here; each OSS call
 * site falls back to today's exact behavior when the method is absent,
 * and the OSS default provider defines none — empty-composition behavior
 * is byte-identical by construction (the local conformance rosters pin
 * it). One provider object carries the edition's whole credential story;
 * the rejected alternative (a second single-instance driver for the
 * exchange) split that story across two objects whose only consumer is
 * the same composition.
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
  | { readonly arm: "workflow-execution"; readonly executionId: string }
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
 * What the sandbox ensure steps know when they mint the credential baked
 * into a provisioned sandbox (steps.ts). `sessionId` is empty on the
 * workflow scope; `callerIdentityId` is empty when the invocation site
 * has no caller (the Java ensure step's null-identity arm, which mints
 * nothing rather than minting unattributed).
 */
export interface SandboxCredentialRequest {
  readonly scope: "session" | "workflow";
  readonly sessionId: string;
  readonly executionId: string;
  readonly org: string;
  readonly callerIdentityId: string;
}

/**
 * Mints and verifies runner credentials per lane. Implementations must be
 * stateless-safe for concurrent use (they gate every ExecutionContext
 * decrypt and every execution dispatch).
 */
export interface RunnerCredentialProvider {
  /**
   * Whether the implementation can currently mint for the lane — false
   * for lanes it does not provide AND for provided lanes with no signing
   * key. Callers that degrade on "cannot mint" (mcpserver connect) probe
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
   * authorization, and mint (the cloud edition's four-arm exchange).
   * When present, the platform controller delegates EVERY arm here;
   * absent, the controller keeps the OSS behavior (execution arms mint
   * on the execution_scoped lane; pool-claim/renewal answer not-minted).
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
   * stigmerToken). When present, the ensure steps delegate here with the
   * full provisioning context; absent, they mint on the execution_scoped
   * lane exactly as before. Returns "" to launch tokenless (the
   * redaction-fallback contract lane.ts documents); a thrown error
   * propagates to the invoking step's own failure posture.
   */
  mintSandboxCredential?(request: SandboxCredentialRequest): string;

  /**
   * The ExecutionContext decrypt trust decision for getByExecutionId
   * (`executionId` is the EC's spec.execution_id). When present, it IS
   * the entire decision — the implementation owns its lane set and scope
   * bindings (the cloud's session/workflow/connect scope rules, including
   * any resource loads through its own clients); absent, the decrypt gate
   * keeps the OSS decision (execution_scoped verify + binding equality).
   * True decrypts; false redacts; never throws for an unrecognized or
   * invalid token — redaction-as-success is the pinned contract.
   */
  authorizeExecutionContextRead?(
    rawToken: string,
    executionId: string,
  ): Promise<boolean>;

  /**
   * Decrypt-key material for a Temporal payload-encryption key id the
   * server's env-configured codec does not hold (C4 Stage 2: the
   * server-managed per-identity `rpk_` keys bootstrapCredentials hands
   * out — resolution belongs on the same object that distributes them).
   * Threaded into the server's decode-only payload codec at compose;
   * consulted only when that codec is installed at all (env-keyed — the
   * cloud composition always configures the platform key). Undefined
   * means unknown: the codec keeps its pinned fail-closed throw. Absent
   * method → today's exact behavior (static env keys only).
   */
  resolvePayloadKey?(keyId: string): Promise<Buffer | undefined>;
}

/**
 * The OSS default: RunnerAuthService behind the provider contract,
 * providing only the execution_scoped lane. A separate adapter rather
 * than the service implementing the interface: the service's concrete
 * lane-free signatures are a stable test surface (and the O2 sub-project
 * edits runnerauth.ts in parallel — this file keeps O5 out of it).
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
  };
}
