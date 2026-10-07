/**
 * Redaction — the one function every Credential-returning boundary calls
 * after its pipeline (get, getByReference, list, create, update, delete,
 * setFields, removeFields). Deliberately not a pipeline step: it runs
 * after Persist, on the message about to leave the server, so the store
 * never sees a marker.
 *
 * revealField is the one sanctioned reveal path and stays unredacted; the
 * run's resolution reads values through values.ts, never the RPC surface.
 */
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";

import { REDACTED_MARKER } from "./constants.js";

/**
 * Replaces every NON-EMPTY secret field value with the marker. Plain
 * fields and descriptions are kept, so a client knows a hidden value
 * exists; an EMPTY secret stays empty (a marker would falsely signal a
 * stored value). Mutates in place: callers hold a fresh store decode or
 * the already-persisted new state.
 */
export function redactCredentialSecrets(credential: Credential | undefined): void {
  const fields = credential?.spec?.fields;
  if (fields === undefined) {
    return;
  }
  for (const field of Object.values(fields)) {
    if (!field.plain && field.value !== "") {
      field.value = REDACTED_MARKER;
    }
  }
}
