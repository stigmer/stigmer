/**
 * The credential list index (store/list-index.ts): the run create path
 * reads one organization's credentials on every run (domain/credential/
 * resolve.ts finds what serves each requirement), so the read is one
 * index range instead of a decode of every credential on the server. The
 * organization is every declaration's first fact; `person` narrows to one
 * person's own, which the run's default step and the list lane read. An
 * organization's credential has no person, and an empty value is no key
 * (`listIndexFactsOf`), so it is read by organization alone.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const credentialListIndex = declareListIndex({
  kind: ApiResourceKind.credential,
  schema: CredentialSchema,
  revision: 1,
  keys: {
    person: field("spec.person"),
  },
});
