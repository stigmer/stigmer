/**
 * Redaction + share-restriction helpers — port
 * pkg/domain/environment/controller/steps/{redact_secret_values,
 * share_restricted}.go. Deliberately NOT pipeline steps: redaction runs
 * post-pipeline at every Environment-returning boundary, and the share
 * restriction is a predicate the visibility pipeline consumes.
 */
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import {
  MANAGED_LABEL_KEY,
  MANAGED_LABEL_VALUE,
  MANAGED_SHARE_RESTRICTION,
  PERSONAL_LABEL_KEY,
  PERSONAL_LABEL_VALUE,
  PERSONAL_SHARE_RESTRICTION,
  REDACTED_MARKER,
} from "./constants.js";

/**
 * Go RedactEnvironmentSecrets: replaces every NON-EMPTY is_secret value
 * with the marker — called at every controller boundary that returns an
 * Environment (get, getByReference, list, create, update, updateVariables,
 * removeVariables, updateVisibility, delete; apply inherits via
 * delegation). getSecretValue is the sanctioned single-key reveal path and
 * stays unredacted; server-internal consumers go through the
 * RuntimeResolutionService, never the RPC surface.
 *
 * is_secret and description are preserved so clients know a hidden value
 * exists; EMPTY secret declarations stay empty (a marker would falsely
 * signal a stored value). Mutates in place: callers hold either a fresh
 * store unmarshal (reads) or the already-persisted new state (writes), so
 * the redaction never reaches the store. Runs strictly AFTER Persist on
 * write paths.
 */
export function redactEnvironmentSecrets(env: Environment | undefined): void {
  const data = env?.spec?.data;
  if (data === undefined) {
    return;
  }
  for (const value of Object.values(data)) {
    if (value.isSecret && value.value !== "") {
      value.value = REDACTED_MARKER;
    }
  }
}

/**
 * Go ShareRestrictionReason: why an environment must never leave private
 * visibility, or "" when no restriction applies.
 *
 * Two classes are share-restricted by construction:
 *   - Personal (stigmer.ai/personal=true): the user's whole credential
 *     fallback bag — org-sharing it would expose every credential the user
 *     ever stored, not a deliberately scoped set.
 *   - Managed (stigmer.ai/managed=true): system-created holders of
 *     per-user OAuth tokens. Sharing OAuth grants needs its own identity
 *     and refresh design (tracked follow-up), so it is rejected rather
 *     than silently half-working.
 *
 * Both editions enforce this identically — the error copy is shared.
 */
export function shareRestrictionReason(
  metadata: ApiResourceMetadata | undefined,
): string {
  const labels = metadata?.labels ?? {};
  if (labels[PERSONAL_LABEL_KEY] === PERSONAL_LABEL_VALUE) {
    return PERSONAL_SHARE_RESTRICTION;
  }
  if (labels[MANAGED_LABEL_KEY] === MANAGED_LABEL_VALUE) {
    return MANAGED_SHARE_RESTRICTION;
  }
  return "";
}
