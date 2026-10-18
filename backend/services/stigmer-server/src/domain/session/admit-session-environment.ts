/**
 * AdmitSessionEnvironment — session create's half of the Environment rule
 * (domain/run/environment-admission.ts): a conversation whose Environment
 * this server's sandboxes cannot honour is refused when it is made, rather
 * than at its first turn. It reads the agent tree a turn would read, as
 * RefuseLocalPrograms does: the pinned agent version, each subagent at its
 * pinned version, and the plugins, so a limited Environment that does not
 * allow MCP servers names an unlisted server's host now. Run create and
 * recover ask again (planRunValues), which catches a driver changed since
 * and an Environment edited or deleted since.
 *
 * Placement: after ResolveSessionEnvironment, whose stamp it reads.
 */
import type { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";

import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type { Store } from "../../store/interface.js";
import { admitEnvironment, loadSessionEnvironment, sessionRunServers } from "../run/environment-admission.js";
import type { EnvironmentPolicy } from "../run/environment-admission.js";

type SessionDesc = typeof SessionSchema;

export function newAdmitSessionEnvironmentStep(
  store: Store,
  policy: EnvironmentPolicy,
): PipelineStep<SessionDesc> {
  return {
    name: "AdmitSessionEnvironment",
    async execute(ctx: RequestContext<SessionDesc>): Promise<void> {
      const session = ctx.newState;
      const environment = await loadSessionEnvironment(store, session);
      if (environment === undefined && (session.spec?.environmentRef?.id ?? "") === "") {
        return;
      }
      const servers = await sessionRunServers(store, session);
      await admitEnvironment({ policy, session, environment, servers });
    },
  };
}
