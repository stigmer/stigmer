/**
 * The API key list index (store/list-index.ts): `owner` is the key's
 * creator stamp, `status.audit.spec_audit.created_by.id`, the account the
 * key speaks for (verifier.ts) and the one its owner tuple names
 * (authorization/derived-tuples.ts). Three lanes read one owner's keys:
 * the caller's own list (`findAll`), an account's keys for its managers
 * (`findByAccount`), and an account's delete, which removes every key that
 * speaks for it (account-keys.ts). Each would
 * otherwise decode every key on the server.
 *
 * Keys belong to no organization (`metadata.org` is empty; a key's
 * organization is `spec.bound_org`), so every read is by owner across
 * organizations.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const apiKeyListIndex = declareListIndex({
  kind: ApiResourceKind.api_key,
  schema: ApiKeySchema,
  revision: 1,
  keys: {
    owner: field("status.audit.spec_audit.created_by.id"),
  },
});
