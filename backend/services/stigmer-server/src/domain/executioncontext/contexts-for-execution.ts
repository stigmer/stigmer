/**
 * Every ExecutionContext that names one execution — the one read behind
 * each lookup of a context by its run's id: the runner's secret read
 * (`LoadByExecutionId`, steps.ts), the runner-credential connect binding
 * (runnerauth/bound-execution.ts) and the server's own delete
 * (internal-delete.ts).
 *
 * A run has one context, the one the server created for it: a wire caller
 * may not create a context naming a run's or a connect's id
 * (`GuardExecutionBinding`, steps.ts). So more than one is never a state
 * to choose within. Each caller decides what two mean, and none guesses:
 * the read refuses, the binding binds nothing, the delete removes every
 * one. A first-match read here would be row-insertion-order
 * nondeterminism deciding whose values a run receives — the reason the
 * store's label lookup has no single-row variant (stigmer/stigmer#356).
 *
 * Proven by executioncontext.test.ts ("only the server binds a context to
 * a run…") and runnerauth/__tests__/bound-execution.test.ts.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../store/interface.js";

/** The store reads this lookup needs, and nothing else. */
export type ExecutionContextLookupStore = Pick<Store, "findAllByField">;

/**
 * The contexts whose `spec.execution_id` is `executionId`, in no order;
 * empty when none. A store fault propagates as the fault it is.
 */
export async function findExecutionContextsForExecution(
  store: ExecutionContextLookupStore,
  executionId: string,
): Promise<ExecutionContext[]> {
  const rows = await store.findAllByField(
    ApiResourceKind.execution_context,
    "spec.executionId",
    executionId,
    ExecutionContextSchema,
  );
  return rows.map((row) => fromBinary(ExecutionContextSchema, row));
}
