/**
 * The built-in plugin-eval caller: an eval's tries and AI-graded checks act
 * as the eval's CREATOR, a plugin eval's or an agent eval's (the id names
 * its kind, domain/plugin-eval/plugin-eval-run.ts evalKindOf). Open source's driver for the
 * pluginEvalCaller seam (extensions/plugin-eval-caller.ts), composed under
 * the built-in authorization posture, in the grading caller's shape
 * (grading-caller.ts beside this file).
 *
 * Why the creator: open source has no system account to own an eval's
 * tries, and the eval row names one person, the one who started it, read
 * from the row's creation stamp, which nothing changes. The tries are then
 * that person's sessions, which they own as any session's creator does.
 *
 * The creator must still be able to edit the eval's parent, as create
 * required (a plugin eval's plugin, an agent eval's agent): the tries spend
 * for the organization and act as the creator, so a creator demoted to
 * viewer mid-eval stops them. The composed authorizer is asked `can_edit`
 * on the parent. A creator who may no
 * longer edit it, or has left the organization, is the seam's
 * deterministic refusal, the try not graded "the eval's creator can no
 * longer run it", as is a stamp that resolves to no account (the laptop's
 * "system", a deleted account); a missing eval, a store fault or an
 * authorizer that cannot answer is an infrastructure throw.
 *
 * Proven by __tests__/plugin-eval-caller.postgres.test.ts on both store
 * drivers.
 */
import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { accountAsCaller } from "../domain/identityaccount/actor.js";
import { evalKindOf } from "../domain/plugin-eval/plugin-eval-run.js";
import { accountForStamp } from "../domain/identityaccount/resolve.js";
import type { AccountsByCaller } from "../domain/identityaccount/resolve.js";
import type { Authorizer } from "../extensions/authorizer.js";
import type { PluginEvalCallerMint } from "../extensions/plugin-eval-caller.js";
import { PluginEvalCallerRefusedError } from "../extensions/plugin-eval-caller.js";
import { auditOf } from "../pipeline/steps/defaults.js";
import type { Store } from "../store/interface.js";

export interface BuiltInPluginEvalCallerDeps {
  readonly store: Store;
  /** The account port: the stamp is resolved as an account id, then as a direct subject. */
  readonly accounts: AccountsByCaller;
  /** The composed authorizer: may the creator still edit the eval's parent (`can_edit`). */
  readonly authorizer: Authorizer;
}

/** The refusal's log copy when the stamp names nobody. */
export function pluginEvalHasNoPersonMessage(evalId: string): string {
  return `plugin eval ${evalId} was created by nobody this server recognizes as a person`;
}

/** The refusal's log copy when the creator may no longer edit the eval's plugin. */
export function creatorCannotEditPluginMessage(
  evalId: string,
  pluginId: string,
): string {
  return `the creator of plugin eval ${evalId} may no longer edit plugin ${pluginId}, so its tries cannot act as them`;
}

/** The refusal's log copy when the creator may no longer edit the agent eval's agent. */
export function creatorCannotEditAgentMessage(evalId: string, agentId: string): string {
  return `the creator of agent eval ${evalId} may no longer edit agent ${agentId}, so its tries cannot act as them`;
}

/** The not-graded reason of a try whose creator may no longer edit the eval's parent. */
export const CREATOR_CANNOT_RUN_EVAL_REASON =
  "the eval's creator can no longer run it";

export function newBuiltInPluginEvalCaller(
  deps: BuiltInPluginEvalCallerDeps,
): PluginEvalCallerMint {
  return {
    async mintPluginEvalCaller(_org, evalId) {
      const evaluated = await evaluatedRowOf(deps.store, evalId);
      const stamp = evaluated.stamp;
      const account = await accountForStamp(deps.accounts, stamp);
      if (account === undefined) {
        throw new PluginEvalCallerRefusedError(
          pluginEvalHasNoPersonMessage(evalId),
        );
      }
      const caller = accountAsCaller(account);
      const decision = await deps.authorizer.authorize(caller, {
        permission: IamPermission.can_edit,
        resourceKind: evaluated.parentKind,
        resourceId: evaluated.parentId,
      });
      if (decision.kind === "unavailable") {
        throw decision.cause;
      }
      if (decision.kind !== "allow") {
        throw new PluginEvalCallerRefusedError(
          evaluated.parentKind === ApiResourceKind.agent
            ? creatorCannotEditAgentMessage(evalId, evaluated.parentId)
            : creatorCannotEditPluginMessage(evalId, evaluated.parentId),
          CREATOR_CANNOT_RUN_EVAL_REASON,
        );
      }
      return caller;
    },
  };
}

/** The eval's creation stamp and its parent, by the kind its id names; a missing row throws. */
async function evaluatedRowOf(
  store: Store,
  evalId: string,
): Promise<{ readonly stamp: string; readonly parentKind: ApiResourceKind; readonly parentId: string }> {
  if (evalKindOf(evalId) === "agent") {
    const agentEval = await store.getResource(ApiResourceKind.agent_eval, evalId, AgentEvalSchema);
    return {
      stamp: auditOf(AgentEvalSchema, agentEval)?.specAudit?.createdBy?.id ?? "",
      parentKind: ApiResourceKind.agent,
      parentId: agentEval.spec?.agentId ?? "",
    };
  }
  const pluginEval = await store.getResource(ApiResourceKind.plugin_eval, evalId, PluginEvalSchema);
  return {
    stamp: auditOf(PluginEvalSchema, pluginEval)?.specAudit?.createdBy?.id ?? "",
    parentKind: ApiResourceKind.plugin,
    parentId: pluginEval.spec?.pluginId ?? "",
  };
}
