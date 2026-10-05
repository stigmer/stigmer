/**
 * The channel app's purge (domain/organization/purge/kind-purge.ts): every
 * channel app of an organization being deleted, removed with its delete
 * chain's cleanup (controller.ts `deleteChannelApp`: the row, its access,
 * its sealed secrets' backing state) and without its refusal of an app a
 * channel references: the channels go first.
 */
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppCommandController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupIamPoliciesStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import type { SecretService } from "../../encryption/encryption.js";
import { newDestroySecretBackingStateStep } from "../../pipeline/steps/secret-cleanup.js";
import { secretValuesOfChannelApp } from "./steps.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";

type DeleteInput = typeof ChannelAppCommandController.method.delete.input;

export interface ChannelAppPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composition's one secret facade. */
  readonly secretService: SecretService;
}

export function newChannelAppPurge(deps: ChannelAppPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.channel_app,
    schema: ChannelAppSchema,
    input: ChannelAppCommandController.method.delete.input,
    steps: [
      newDeleteResourceStep(deps.store),
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
      newDestroySecretBackingStateStep<DeleteInput, typeof ChannelAppSchema>(
        deps.secretService,
        deps.logger,
        secretValuesOfChannelApp,
      ),
    ],
  });
}
