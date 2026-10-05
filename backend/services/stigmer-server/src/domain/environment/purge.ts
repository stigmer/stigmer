/**
 * The environment's purge (domain/organization/purge/kind-purge.ts): every
 * environment of an organization being deleted, removed with its delete
 * chain's cleanup (controller.ts `deleteEnvironment`: the row, its access,
 * its sealed secrets' backing state, its search entry).
 */
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newDeleteSearchIndexStep } from "../../pipeline/steps/index-search.js";
import type { SecretService } from "../../encryption/encryption.js";
import { newDestroySecretBackingStateStep } from "../../pipeline/steps/secret-cleanup.js";
import { secretValuesOfEnvironment } from "./steps.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";

type DeleteInput = typeof EnvironmentCommandController.method.delete.input;

export interface EnvironmentPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composition's one secret facade. */
  readonly secretService: SecretService;
}

export function newEnvironmentPurge(deps: EnvironmentPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.environment,
    schema: EnvironmentSchema,
    input: EnvironmentCommandController.method.delete.input,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      newDestroySecretBackingStateStep<DeleteInput, typeof EnvironmentSchema>(
        deps.secretService,
        deps.logger,
        secretValuesOfEnvironment,
      ),
      newDeleteSearchIndexStep(deps.store, deps.logger),
    ],
  });
}
