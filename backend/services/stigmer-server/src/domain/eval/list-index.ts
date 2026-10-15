/**
 * The eval list index (store/list-index.ts): list reads one organization's
 * evals newest first, so the declaration needs no key beyond the
 * organization and the creation order every declaration carries.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { EvalSchema } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex } from "../../store/list-index.js";

export const evalListIndex = declareListIndex({
  kind: ApiResourceKind.eval,
  schema: EvalSchema,
  revision: 1,
  keys: {},
});
