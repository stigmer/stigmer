/**
 * The DeleteExecutionContext activity's name — ports the registration
 * constant of
 * pkg/domain/executioncontext/temporal/activities/delete_execution_context.go.
 *
 * The agent-execution worker registers the activity under this name, and
 * its workflow calls it when a run ends; its body is the server's own
 * delete of the run's context (domain/executioncontext/internal-delete.ts),
 * as in Go.
 *
 * This module holds the name alone because the workflow imports it: it is
 * part of the deterministic sandbox bundle (temporal/README.md, the
 * workflow-bundle import discipline), so it carries no store, proto or RPC
 * import.
 */

/** The activity name for worker registration — Go's constant, byte-pinned. */
export const DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME = "DeleteExecutionContext";
