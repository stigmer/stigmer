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
 */
import type { MintedToken } from "./runnerauth.js";
import {
  InvalidTokenError,
  RunnerAuthService,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "./runnerauth.js";

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
