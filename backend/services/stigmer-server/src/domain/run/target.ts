/**
 * The two readings of an execution's `target` oneof every reader needs:
 * the session a turn continues, and the spec of a new session it starts.
 * An unset target, and a session_id arm holding an empty string, both read
 * as "no existing session": a new conversation with the built-in
 * assistant when no session_spec is set either. One place, so no reader
 * spells the oneof's empty-string case its own way.
 */
import type { RunSpec } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import type { SessionSpec } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";

/** The existing session a turn continues, or "" for a new conversation. */
export function sessionIdOf(spec: RunSpec | undefined): string {
  return spec?.target.case === "sessionId" ? spec.target.value : "";
}

/** The spec of the new session a turn starts, when it carries one. */
export function newSessionSpecOf(
  spec: RunSpec | undefined,
): SessionSpec | undefined {
  return spec?.target.case === "sessionSpec" ? spec.target.value : undefined;
}
