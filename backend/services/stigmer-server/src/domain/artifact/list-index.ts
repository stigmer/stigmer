/**
 * The artifact list index (store/list-index.ts): an artifact names the
 * execution that produced it, agent or workflow, and
 * `listByExecution` reads the one the request names. `blob` is the
 * content hash the artifact's blob is stored under: blobs are shared by
 * every artifact with the same bytes, and an organization's purge removes
 * a blob only when no other artifact names it (purge.ts).
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const artifactListIndex = declareListIndex({
  kind: ApiResourceKind.artifact,
  schema: ArtifactSchema,
  revision: 2,
  keys: {
    agent_execution: field("spec.source.agent_execution_id"),
    workflow_execution: field("spec.source.workflow_execution_id"),
    blob: field("status.content_hash"),
  },
});
