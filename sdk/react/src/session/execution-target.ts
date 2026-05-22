import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

/**
 * String literal alias for the proto {@link ExecutionTarget} enum.
 *
 * Used on hook options so platform builders do not need to import
 * proto enums to configure where session activities execute.
 *
 * - `"local"` — Client's embedded runner (desktop app or CLI) polls
 *   the session's task queue.
 * - `"cloud"` — Server provisions a cloud sandbox with a runner.
 */
export type ExecutionTargetOption = "local" | "cloud";

/** Convert an {@link ExecutionTargetOption} string to the proto {@link ExecutionTarget} enum. */
export function toProtoExecutionTarget(t: ExecutionTargetOption): ExecutionTarget {
  switch (t) {
    case "local":
      return ExecutionTarget.LOCAL;
    case "cloud":
      return ExecutionTarget.CLOUD;
  }
}

/**
 * Convert a proto {@link ExecutionTarget} enum to an {@link ExecutionTargetOption} string,
 * or `undefined` when the value is `UNSPECIFIED` (server decides).
 */
export function fromProtoExecutionTarget(t: ExecutionTarget): ExecutionTargetOption | undefined {
  switch (t) {
    case ExecutionTarget.LOCAL:
      return "local";
    case ExecutionTarget.CLOUD:
      return "cloud";
    case ExecutionTarget.UNSPECIFIED:
    default:
      return undefined;
  }
}
