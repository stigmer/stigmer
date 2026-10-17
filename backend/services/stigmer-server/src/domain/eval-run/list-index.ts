/**
 * The eval run list index (store/list-index.ts): `agent` and `plugin` are
 * the keys listByAgent and listByPlugin read, and the agent-delete and
 * plugin-delete cascades. Each reads one member of the spec's subject
 * oneof, so a row has exactly one of them; an empty value is no key. The
 * organization and the creation order are every declaration's: the lists
 * answer newest first, and the organization purge reads by organization.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const evalRunListIndex = declareListIndex({
  kind: ApiResourceKind.eval_run,
  schema: EvalRunSchema,
  revision: 1,
  keys: {
    agent: field("spec.agent_id"),
    plugin: field("spec.plugin_id"),
  },
});
