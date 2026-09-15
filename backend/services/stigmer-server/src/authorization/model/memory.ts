/**
 * Transcript of fga/model/agentic/memory.fga — subject-only: the person a
 * memory is ABOUT is its one principal (no owner, no creator, no
 * visibility, nothing grantable; `kind_meta` attribution NONE with
 * `subject` as an additional parent on `spec.subject_identity_account_id`).
 * Organization admins govern the organization's memory switch and never
 * read content, in the contract's own words. A row whose subject field is
 * empty derives no principal at all — the derivation's rule for an
 * absent parent — and is then nobody's under this evaluator.
 */
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { computed, declareKind, direct, objectOf } from "./rewrite.js";

export const memoryDeclaration = declareKind({
  kind: ApiResourceKind.memory,
  schema: MemorySchema,
  source: "fga/model/agentic/memory.fga",
  relations: [
    ["organization", direct(objectOf("organization"))],
    ["subject", direct(objectOf("identity_account"))],
    ["can_view", computed("subject")],
    ["can_edit", computed("subject")],
    ["can_delete", computed("subject")],
  ],
});
