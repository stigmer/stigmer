/**
 * Runner-held master secret for HITL approval fingerprints (Phase 2).
 *
 * The per-execution fingerprint key is derived from this secret + `execution_id`
 * (see {@link file://./approval-fingerprint.ts} `deriveExecutionFingerprintKey`).
 * Source precedence:
 *
 *  1. `STIGMER_RUNNER_HITL_SECRET` env var (UTF-8), when set — the only way to get
 *     a key that is STABLE across runner processes/replicas. Required once a lease
 *     becomes a cross-process bearer token (Phase 7); optional today.
 *  2. A per-process random secret generated once at first use — sufficient for
 *     Phase 2 because the fingerprint is recompute-and-compare WITHIN one runner
 *     process for a given execution: the deep-agent gateway runs in-process, and
 *     the Cursor key is written to and read from the per-session state file by the
 *     same process. A process restart re-keys, which can only *re-ask* a pending
 *     approval (fail-safe), never silently mis-authorize.
 *
 * The secret is never logged. The value is memoized so the per-process fallback
 * stays stable for the lifetime of the process.
 */

import { randomBytes, type BinaryLike } from "node:crypto";
import { getRunnerSecret } from "./runner-credential-store.js";

const ENV_VAR = "STIGMER_RUNNER_HITL_SECRET";

let cached: Buffer | undefined;
let warned = false;

/**
 * Return the runner's HITL master secret (operator-configured via the
 * {@link ENV_VAR} env var, resolved through the credential store since the
 * #508 boot capture; else a stable per-process random fallback). Memoized.
 */
export function getRunnerHitlMasterSecret(): BinaryLike {
  if (cached) return cached;

  const fromEnv = getRunnerSecret(ENV_VAR);
  if (fromEnv && fromEnv.length > 0) {
    cached = Buffer.from(fromEnv, "utf-8");
    return cached;
  }

  cached = randomBytes(32);
  if (!warned) {
    warned = true;
    console.warn(
      `[hitl-gateway] ${ENV_VAR} is not set; using a per-process random ` +
      "fingerprint secret. Fingerprints are stable within this process only — " +
      `set ${ENV_VAR} for a key stable across runner restarts/replicas ` +
      "(required in Phase 7).",
    );
  }
  return cached;
}
