/**
 * The server's own delete of a run's ExecutionContext — ports
 * pkg/domain/executioncontext/temporal/activities/delete_execution_context.go,
 * and is the one function every server-internal delete of a context calls:
 * the DeleteExecutionContext activity both execution workers register when
 * a run ends, and both recover steps before they recreate the context.
 *
 * The ExecutionContext is an ephemeral resource containing the
 * fully-merged environment (environment_refs values overridden by
 * runtime_env, filtered to the blueprint's declared env keys), including
 * secrets. It must be cleaned up when the execution finishes so sensitive
 * data does not persist beyond the execution lifetime.
 *
 * The find is a store read (a pure read has no chain to bypass); the delete
 * is the context's own delete chain, reached through the in-process edge
 * (`ExecutionContextDeleter`, served by boot/inprocess.ts), so the context
 * goes exactly as its delete RPC removes it: `CleanupIamPolicies`,
 * `DeleteSearchIndex` and any step the chain gains later run by
 * construction. Its predecessors deleted the row with a bare
 * `store.deleteResource`, which left the search row its create indexed and
 * fired no cleanup event (stigmer#1647). The edge acts as the server, the
 * `internal` caller class the create used: the context is the server's, and
 * so is its removal.
 *
 * Behavior (Go parity):
 *   - Idempotent: no-op if the ExecutionContext does not exist, or is gone
 *     by the time the chain loads it.
 *   - Best-effort: logs failures but never throws — cleanup failure must
 *     not affect the workflow outcome or the recover. A failed delete
 *     leaves the row in place with its secret values still encrypted at
 *     rest (oss#535); nothing retries it later (oss#892), so the WARN is
 *     the operator's signal.
 *   - Security-aware: logs the variable count, never names or values.
 *
 * Proven by executioncontext.test.ts (the seam's arms) and
 * extension-composition.test.ts's case for the server's own delete (the
 * real chain: the cleanup
 * event and the search row).
 */
import { Code, ConnectError } from "@connectrpc/connect";

import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import { findExecutionContextsForExecution } from "./contexts-for-execution.js";
import type { ExecutionContextLookupStore } from "./contexts-for-execution.js";

/**
 * The server's own delete of one context, by id, through the context's
 * delete chain (the in-process edge, boot/inprocess.ts). Narrow by design:
 * the chain's redacted echo never leaves the adapter.
 */
export interface ExecutionContextDeleter {
  delete(contextId: string): Promise<void>;
}

export interface InternalDeleteDeps {
  /** The find by `spec.executionId`: a pure read, store-direct. */
  readonly store: ExecutionContextLookupStore;
  /** Read per call: the in-process edge exists only once the routes do. */
  readonly deleter: () => ExecutionContextDeleter;
  readonly logger: Logger;
}

/** Why the server deletes the context, logged with every outcome. */
export type InternalDeleteReason = "run-end" | "recover";

/**
 * Finds the ExecutionContext of the given execution (an AgentExecution or
 * WorkflowExecution id — the lookup uses the spec.executionId field) and
 * deletes it through the context's delete chain. A run has one; if more
 * than one names it, every one is deleted, each through the chain.
 */
export async function deleteExecutionContextForExecution(
  deps: InternalDeleteDeps,
  executionId: string,
  reason: InternalDeleteReason,
): Promise<void> {
  const { store, logger } = deps;
  logger.debug("Cleaning up ExecutionContext for execution", {
    executionId,
    reason,
  });

  let contexts: ExecutionContext[];
  try {
    contexts = await findExecutionContextsForExecution(store, executionId);
  } catch (error) {
    logger.warn(
      "Failed to query ExecutionContext -- leaving cleanup to the operator",
      {
        executionId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return;
  }

  if (contexts.length === 0) {
    logger.debug(
      "No ExecutionContext found for execution -- nothing to clean up",
      { executionId, reason },
    );
    return;
  }
  if (contexts.length > 1) {
    // A run has one context (contexts-for-execution.ts); a second is a row
    // no lookup will read, so it goes with the run instead of outliving it.
    logger.warn(
      "More than one ExecutionContext names the execution -- deleting every one",
      {
        executionId,
        reason,
        contextIds: contexts.map((ec) => ec.metadata?.id ?? ""),
      },
    );
  }
  for (const ec of contexts) {
    await deleteOne(deps, ec, executionId, reason);
  }
}

/** One context through the delete chain; best-effort, never throws. */
async function deleteOne(
  deps: InternalDeleteDeps,
  ec: ExecutionContext,
  executionId: string,
  reason: InternalDeleteReason,
): Promise<void> {
  const { logger } = deps;
  const contextId = ec.metadata?.id ?? "";
  const dataCount = Object.keys(ec.spec?.data ?? {}).length;
  if (contextId === "") {
    // A row with no id has nothing the chain can load by; it is skipped
    // quietly, as the recover steps' predecessors skipped it.
    logger.debug("ExecutionContext row carries no id -- nothing to delete", {
      executionId,
      reason,
    });
    return;
  }

  try {
    await deps.deleter().delete(contextId);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      // Gone between the read and the chain's load: another delete won.
      logger.debug("ExecutionContext already deleted -- nothing to clean up", {
        executionId,
        contextId,
        reason,
      });
      return;
    }
    logger.warn(
      "Failed to delete ExecutionContext -- leaving cleanup to the operator",
      {
        executionId,
        contextId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return;
  }

  logger.info("Deleted ExecutionContext for execution", {
    executionId,
    contextId,
    reason,
    variables: dataCount,
  });
}
