/**
 * The workflow-execution list index (store/list-index.ts): a run names
 * its workflow and, when it ran through one, its instance;
 * `listByWorkflow` accepts either id, so it reads both keys at once.
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
  revision: 1,
  keys: {
    workflow: field("spec.workflow_id"),
    workflow_instance: field("spec.workflow_instance_id"),
  },
});
