/**
 * The skill's purge (domain/organization/purge/kind-purge.ts): every
 * skill of an organization being deleted, removed with its delete chain's
 * cleanup (controller.ts `deleteSkill`: its version archives, the row, its
 * access, its search entry) and without its refusal of a plugin-managed
 * skill: the plugin goes too. The archives step is the chain's own
 * content-addressed factory with the chain's name.
 */
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newDeleteSearchIndexStep } from "../../pipeline/steps/index-search.js";
import { newDeleteVersionArchivesStep } from "../../pipeline/steps/version-archive.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";

type DeleteInput = typeof SkillCommandController.method.delete.input;

export interface SkillPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

export function newSkillPurge(deps: SkillPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.skill,
    schema: SkillSchema,
    input: SkillCommandController.method.delete.input,
    steps: [
      newDeleteVersionArchivesStep<DeleteInput>(deps.store, deps.logger, {
        stepName: "DeleteSkillArchives",
        noun: "skill",
      }),
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      newDeleteSearchIndexStep(deps.store, deps.logger),
    ],
  });
}
