/**
 * RefuseLocalPrograms — session create's half of the local-program rule
 * (domain/run/local-programs.ts): a conversation whose turns would run in
 * a hosted sandbox that cannot start a local program is refused when it is
 * made, naming the plugin and the server, rather than at its first turn.
 * It reads the plugins a turn would read: the pinned agent version's and
 * the conversation's own (domain/run/run-plugins.ts). Run create checks
 * again, which catches a plugin added to the agent or the conversation
 * later.
 *
 * Placement: after ResolveSessionAgent, which pins the agent version this
 * step reads.
 */
import type { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { loadVersion } from "../../pipeline/steps/version-history.js";
import type { Store } from "../../store/interface.js";
import { agentVersionBinding } from "../agent/versions.js";
import { refuseLocalPrograms } from "../run/local-programs.js";
import type { LocalProgramPolicy } from "../run/local-programs.js";
import { loadRunPlugins, runPluginReferences } from "../run/run-plugins.js";

type SessionDesc = typeof SessionSchema;

export function newRefuseLocalProgramsStep(
  store: Store,
  policy: LocalProgramPolicy,
): PipelineStep<SessionDesc> {
  return {
    name: "RefuseLocalPrograms",
    async execute(ctx: RequestContext<SessionDesc>): Promise<void> {
      const session = ctx.newState;
      const target = session.spec?.executionTarget ?? ExecutionTarget.UNSPECIFIED;
      if (!policy.refusesLocalPrograms(target)) {
        return;
      }
      const org = session.metadata?.org ?? "";
      const agentId = session.status?.agentId ?? "";
      const versionHash = session.status?.agentVersionHash ?? "";
      const agentSpec =
        agentId === "" || versionHash === ""
          ? undefined
          : (await loadVersion(store, agentVersionBinding, agentId, versionHash)).resource.spec;
      const plugins = await loadRunPlugins(store, runPluginReferences(agentSpec, session, org), org);
      refuseLocalPrograms(policy, target, plugins);
    },
  };
}
