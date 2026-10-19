/**
 * The File list index (store/list-index.ts): `list` reads one
 * organization's Files newest first, or one conversation's (`session`, the
 * File's status.session_id), and a conversation's delete reads its Files
 * by the same key (session-files.ts).
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const fileListIndex = declareListIndex({
  kind: ApiResourceKind.file,
  schema: FileSchema,
  revision: 1,
  keys: {
    session: field("status.session_id"),
  },
});
