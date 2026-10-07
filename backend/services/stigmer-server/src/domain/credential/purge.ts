/**
 * The credential's purge (domain/organization/purge/kind-purge.ts): every
 * credential of an organization being deleted, removed with its delete
 * chain's cleanup (controller.ts `deleteCredential`: the row, its access,
 * its sealed secrets' backing state). The organization's sign-in grants
 * are the grant store's own purge (deleteByOrg).
 */
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialCommandController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import type { SecretService } from "../../encryption/encryption.js";
import { newDestroySecretBackingStateStep } from "../../pipeline/steps/secret-cleanup.js";
import { secretValuesOfCredential } from "./steps.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";

type DeleteInput = typeof CredentialCommandController.method.delete.input;

export interface CredentialPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composition's one secret facade. */
  readonly secretService: SecretService;
}

export function newCredentialPurge(deps: CredentialPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.credential,
    schema: CredentialSchema,
    input: CredentialCommandController.method.delete.input,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      newDestroySecretBackingStateStep<DeleteInput, typeof CredentialSchema>(
        deps.secretService,
        deps.logger,
        secretValuesOfCredential,
      ),
    ],
  });
}
