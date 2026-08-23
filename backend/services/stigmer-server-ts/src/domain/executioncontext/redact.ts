/**
 * Redaction helper — ports
 * pkg/domain/executioncontext/controller/redact_secret_values.go.
 * Deliberately NOT a pipeline step: redaction runs post-pipeline at every
 * ExecutionContext-returning boundary outside the runner lane.
 */
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";

import { REDACTED_MARKER } from "../environment/constants.js";

/**
 * Go RedactExecutionContextSecrets: replaces every NON-EMPTY is_secret
 * value with the marker — called at every controller boundary that
 * returns an ExecutionContext to a caller outside the runner lane: get,
 * getByReference, the create/apply response echo, the delete response
 * echo, and getByExecutionId for callers without a scope-bound runner
 * token. The EC twin of the environment domain's redaction (oss#535); the
 * marker is imported from that domain so the sentinel has a single source
 * of truth, the same move both Go domains make.
 *
 * is_secret is preserved so clients know a hidden value exists; EMPTY
 * secret declarations stay empty (a marker would falsely signal a stored
 * value). Redaction is representation-agnostic: it replaces whatever is
 * stored (ciphertext or legacy pre-oss#535 plaintext). Mutates in place —
 * callers hold either a fresh store unmarshal (reads) or the
 * already-persisted new state (create echo), so redaction never reaches
 * the store. Runs strictly AFTER Persist and IndexSearch on the create
 * path.
 */
export function redactExecutionContextSecrets(
  ec: ExecutionContext | undefined,
): void {
  const data = ec?.spec?.data;
  if (data === undefined) {
    return;
  }
  for (const value of Object.values(data)) {
    if (value.isSecret && value.value !== "") {
      value.value = REDACTED_MARKER;
    }
  }
}
