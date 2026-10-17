/**
 * The channel's purge (domain/organization/purge/kind-purge.ts): every
 * channel of an organization being deleted, removed with its delete
 * chain's cleanup (controller.ts `deleteChannel`): for a Slack or WhatsApp
 * channel, the composed channel runtime's teardown when one is composed (an
 * edition's install and its stored delivery state); the row; its access.
 * An agent's own purge cascades its channels first (cascade.ts); this one
 * removes any the organization holds that its agents' purges did not
 * reach.
 */
import { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelCommandController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newCleanupGrantsStep } from "../../pipeline/steps/authorization-tuples.js";
import { newDeleteResourceStep } from "../../pipeline/steps/delete.js";
import { newReleaseNamesStep } from "../../pipeline/steps/names.js";
import type { ChannelRuntime } from "./channel-runtime.js";
import { newTeardownChannelRuntimeStep } from "./steps.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";

type DeleteInput = typeof ChannelCommandController.method.delete.input;

export interface ChannelPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed channel runtime; undefined when no unit composes one. */
  readonly channelRuntime: ChannelRuntime | undefined;
}

export function newChannelPurge(deps: ChannelPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.channel,
    schema: ChannelSchema,
    input: ChannelCommandController.method.delete.input,
    steps: [
      ...(deps.channelRuntime === undefined
        ? []
        : [newTeardownChannelRuntimeStep<DeleteInput>(deps.channelRuntime)]),
      newDeleteResourceStep(deps.store),
      newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.channel),
      newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger),
    ],
  });
}
