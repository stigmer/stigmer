/**
 * Runner-held master secret for HITL approval fingerprints.
 *
 * The per-execution fingerprint key is derived from this secret + `execution_id`
 * (see {@link file://./approval-fingerprint.ts} `deriveExecutionFingerprintKey`).
 * Source precedence:
 *
 *  1. `STIGMER_RUNNER_HITL_SECRET` env var (UTF-8), when set — the only way to get
 *     a key that is STABLE across runner processes/replicas. Required once a lease
 *     becomes a cross-process bearer token; optional today.
 *  2. A per-process random secret generated once at first use — sufficient
 *     today because the fingerprint is recompute-and-compare WITHIN one runner
 *     process for a given execution: the deep-agent gateway runs in-process, and
 *     the Cursor key is written to and read from the per-session state file by the
 *     same process. A process restart re-keys, which can only *re-ask* a pending
 *     approval (fail-safe), never silently mis-authorize.
 *
 * The secret is never logged. The value is memoized so the per-process fallback
 * stays stable for the lifetime of the process.
 */

import { randomBytes, type BinaryLike } from "node:crypto";
import { deriveExecutionFingerprintKey } from "./approval-fingerprint.js";
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
      `set ${ENV_VAR} for a key stable across runner restarts/replicas.`,
    );
  }
  return cached;
}

/**
 * Where a process that holds no master secret gets each execution's key:
 * the agent host, which runs the engines and is handed the key of each turn
 * it runs by the runner (`agent-host/host.ts`, #2016). The master secret
 * never leaves the runner; a key opens one execution's receipts only.
 */
let suppliedKeys: ((executionId: string) => Buffer | undefined) | undefined;

/** Install the agent host's per-turn key source. */
export function supplyExecutionFingerprintKeys(source: (executionId: string) => Buffer | undefined): void {
  suppliedKeys = source;
}

/**
 * The per-execution fingerprint key a harness signs its approval receipts
 * with: the one the runner supplied for this execution, or the key derived
 * from this process's own master secret.
 */
export function executionFingerprintKey(executionId: string): Buffer {
  return suppliedKeys?.(executionId) ?? deriveExecutionFingerprintKey(getRunnerHitlMasterSecret(), executionId);
}
