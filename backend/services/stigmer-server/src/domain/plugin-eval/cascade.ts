/**
 * CascadeDeletePluginEvals: a plugin's delete removes its evals before the
 * plugin row goes, each with its tries' conversations (tries.ts), read
 * through the eval list index. Each eval's access goes with its row while
 * the plugin still links it to its organization, as the agent's evaluator
 * cascade does (domain/evaluator/cascade.ts). An eval still pending or
 * running refuses the delete, naming cancel: its tries may hold an active
 * run, which a conversation's delete refuses. Runs before every other
 * cascade of the plugin's delete, so a refusal removes nothing. An eval
 * created while the delete runs is swept after the plugin's row goes
 * (SweepPluginEvalsAfterDelete). A composition that serves no evals passes
 * no deps, and the steps do nothing.
 *
 * Proven by __tests__/plugin-eval.test.ts (the plugin's delete) and
 * __tests__/cascade.test.ts (the race with a create).
 */
import type { DescMessage } from "@bufbuild/protobuf";

import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { failedPreconditionError, internalError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { cleanUpDeletedResource } from "../../pipeline/steps/authorization-tuples.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import { pluginEvalActiveOnPluginDeleteMessage } from "./constants.js";
import { listPluginEvals } from "./queries.js";
import { isActivePluginEval } from "./steps.js";
import { deletePluginEvalTries } from "./tries.js";
import type { TrySessionDeleter } from "./tries.js";

export interface PluginEvalCascadeDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** Resolved at call time: the in-process clients are wired after the routes. */
  readonly sessions: () => TrySessionDeleter;
}

export function newCascadeDeletePluginEvalsStep<Desc extends DescMessage>(
  deps: PluginEvalCascadeDeps | undefined,
): PipelineStep<Desc> {
  return {
    name: "CascadeDeletePluginEvals",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (deps === undefined) {
        return;
      }
      const plugin = ctx.get(EXISTING_RESOURCE_KEY) as Plugin | undefined;
      if (plugin === undefined) {
        throw internalError(
          new Error("plugin not found in context (LoadExistingForDelete must run first)"),
          "plugin not found in context (LoadExistingForDelete must run first)",
        );
      }
      const pluginId = plugin.metadata?.id ?? "";
      let evals: PluginEval[];
      try {
        evals = await listPluginEvals(deps.store, deps.logger, pluginId);
      } catch (error) {
        throw internalError(error, "failed to list the plugin's evals for cascade delete");
      }
      const active = evals.find(isActivePluginEval);
      if (active !== undefined) {
        throw failedPreconditionError(
          pluginEvalActiveOnPluginDeleteMessage(active.metadata?.id ?? ""),
        );
      }
      for (const pluginEval of evals) {
        await deleteEval(deps, ctx, pluginEval, pluginId);
      }
    },
  };
}

/**
 * SweepPluginEvalsAfterDelete: after the plugin's row is gone (and before
 * its access is cleaned), the plugin's evals are listed again and each one
 * found is deleted the cascade's way, whatever its phase: an eval created
 * while the delete ran. With create's own re-read of the plugin after it
 * stores the eval (steps.ts EnsureEvaluatedPluginStillExists), no eval
 * outlives its plugin: one stored before this list is found here, and one
 * stored after it meets a plugin already gone and deletes itself.
 */
export function newSweepPluginEvalsAfterDeleteStep<Desc extends DescMessage>(
  deps: PluginEvalCascadeDeps | undefined,
): PipelineStep<Desc> {
  return {
    name: "SweepPluginEvalsAfterDelete",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (deps === undefined) {
        return;
      }
      const plugin = ctx.get(EXISTING_RESOURCE_KEY) as Plugin | undefined;
      const pluginId = plugin?.metadata?.id ?? "";
      let evals: PluginEval[];
      try {
        evals = await listPluginEvals(deps.store, deps.logger, pluginId);
      } catch (error) {
        throw internalError(error, "failed to list the plugin's evals after its delete");
      }
      for (const pluginEval of evals) {
        deps.logger.warn("a plugin eval was created while its plugin was deleted; deleting it", {
          evalId: pluginEval.metadata?.id ?? "",
          pluginId,
        });
        await deleteEval(deps, ctx, pluginEval, pluginId);
      }
    },
  };
}

/** One eval of a deleted plugin: its tries' conversations, its row, then its access. */
async function deleteEval<Desc extends DescMessage>(
  deps: PluginEvalCascadeDeps,
  ctx: RequestContext<Desc>,
  pluginEval: PluginEval,
  pluginId: string,
): Promise<void> {
  const evalId = pluginEval.metadata?.id ?? "";
  await deletePluginEvalTries(deps.store, deps.sessions(), deps.logger, evalId);
  try {
    await deps.store.deleteResource(ApiResourceKind.plugin_eval, evalId);
  } catch (error) {
    throw internalError(
      error,
      `failed to cascade-delete plugin eval ${evalId} of plugin ${pluginId}`,
    );
  }
  await cleanUpDeletedResource(deps.authorizationLifecycle, deps.logger, {
    kind: ApiResourceKind.plugin_eval,
    resourceId: evalId,
    orgId: pluginEval.metadata?.org ?? "",
    caller: ctx.callerIdentity,
  });
}
