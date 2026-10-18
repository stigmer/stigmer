/**
 * The Environment's purge (domain/organization/purge/kind-purge.ts): every
 * Environment of an organization being deleted, removed with its delete
 * chain's cleanup (controller.ts `deleteEnvironment`: the row, its name,
 * its access) and without its refusal of an Environment an agent, a
 * routine or the organization's default names: they go with the
 * organization.
 */
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupGrantsStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newReleaseNamesStep } from "../../pipeline/steps/names.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type { KindPurge, KindPurgeDeps } from "../organization/purge/kind-purge.js";

export interface EnvironmentPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newEnvironmentPurge(deps: EnvironmentPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.environment,
    schema: EnvironmentSchema,
    input: EnvironmentCommandController.method.delete.input,
    steps: [
      newDeleteResourceStep(deps.store),
      newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.environment),
      newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
}
