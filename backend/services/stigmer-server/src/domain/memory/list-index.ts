/**
 * The memory list index (store/list-index.ts): `subject` is the key
 * recall and the per-subject cap read (queries.ts beside this file), so
 * both answer from one person's rows instead of decoding every memory on
 * the server — recall runs on every execution create in a memory-on
 * organization (stigmer#1405). The organization needs no key: it is every
 * declaration's first fact, which is how `memory.list` reads one
 * organization's rows.
 *
 * Lifecycle state is not a key. A key reads a string field and the state
 * is an enum; the rows it would narrow are one subject's in one
 * organization, which the cap bounds (MAX_MEMORIES_PER_SUBJECT), so the
 * readers filter it in process. The single-operator posture files every
 * memory under the "" subject sentinel, and an empty value is no key
 * (`listIndexFactsOf`), so that subject reads by organization alone.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const memoryListIndex = declareListIndex({
  kind: ApiResourceKind.memory,
  schema: MemorySchema,
  revision: 1,
  keys: {
    subject: field("spec.subject_identity_account_id"),
  },
});
