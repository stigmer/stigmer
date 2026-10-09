/**
 * The OAuth app's purge (domain/organization/purge/kind-purge.ts): every
 * OAuth app of an organization being deleted, removed with its delete
 * chain's cleanup (controller.ts `deleteOAuthApp`: the row, its access, its
 * sealed client secret's backing state, its address claims).
 */
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { OAuthAppCommandController } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import type { SecretService } from "../../encryption/encryption.js";
import { newDestroySecretBackingStateStep } from "../../pipeline/steps/secret-cleanup.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import { newReleaseAddressesStep } from "./addresses.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";

type DeleteInput = typeof OAuthAppCommandController.method.delete.input;

export interface OAuthAppPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composition's one secret facade. */
  readonly secretService: SecretService;
}

export function newOAuthAppPurge(deps: OAuthAppPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.oauth_app,
    schema: OAuthAppSchema,
    input: OAuthAppCommandController.method.delete.input,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      newDestroySecretBackingStateStep<DeleteInput, typeof OAuthAppSchema>(
        deps.secretService,
        deps.logger,
        (app) => (app.spec === undefined ? [] : [app.spec.clientSecret]),
      ),
      newReleaseAddressesStep<DeleteInput>(deps.store, deps.logger),
    ],
  });
}
