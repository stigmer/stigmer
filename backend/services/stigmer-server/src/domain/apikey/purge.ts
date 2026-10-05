/**
 * The API key's purge (domain/organization/purge/kind-purge.ts): every key
 * limited to an organization being deleted (`spec.bound_org`), removed with
 * its delete chain's cleanup (controller.ts `deleteApiKey`: the row and its
 * access). A key is its owner's, not the organization's, but a key limited
 * to an organization can work nowhere once it is gone. A key limited
 * elsewhere, or not limited, stays.
 */
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";

export interface ApiKeyPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newApiKeyPurge(deps: ApiKeyPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.api_key,
    schema: ApiKeySchema,
    input: ApiKeyCommandController.method.delete.input,
    belongsTo: (key, org) => (key.spec?.boundOrg ?? "") === org.id,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
}
