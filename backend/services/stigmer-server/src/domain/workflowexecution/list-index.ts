/**
 * The workflow-execution list index (store/list-index.ts): a run names
 * its workflow, and `listByWorkflow` reads that one key. Revision 2
 * dropped the instance key when the instance kind was removed; a row
 * indexed at another revision is repaired on read.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const workflowExecutionListIndex = declareListIndex({
  kind: ApiResourceKind.workflow_execution,
  schema: WorkflowExecutionSchema,
  revision: 2,
  keys: {
    workflow: field("spec.workflow_id"),
  },
});
