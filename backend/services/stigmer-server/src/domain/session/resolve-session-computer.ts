/**
 * ResolveSessionComputer — records whether a conversation has a computer on
 * status.computer, from the agent version ResolveSessionAgent pinned
 * (AgentSpec.computer; no agent, the built-in assistant, has one), and
 * refuses what a conversation without one may not add
 * (domain/run/computer.ts).
 *
 * The stamp follows the Environment's rule (resolve-session-environment.ts):
 * worked out again on every write until the conversation has run
 * (has-run.ts), then kept. A conversation keeps the computer it started
 * with; a re-pin to a version that says otherwise changes only new
 * conversations, as a re-pinned engine does.
 *
 * The refusals run on every write, not only until the first turn: an update
 * runs neither the local-program nor the Environment admission again, so a
 * repository, a folder, an Environment or a plugin added after the first
 * turn would otherwise get past a check that ran only at create. They read
 * the conversation's own plugins; the agent's were judged at its save, and
 * every plugin a turn loads is judged again at the turn's create
 * (plan-run-values-step.ts).
 *
 * resolveSessionComputer is exported for the routine's admission, which
 * asks the conversation a fire would make the same questions in memory
 * (domain/routine/admit-run.ts).
 *
 * Placement: after ResolveSessionAgent, which pins the version this step
 * reads, and before ResolveSessionEnvironment, which skips every default
 * Environment for a conversation without a computer.
 *
 * Tests: __tests__/resolve-session-computer.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { Session, SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/status_pb";

import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import { readRunAgentSpec } from "../agent/run-defaults.js";
import { agentComputer, hasComputer, refuseConversationWithoutComputer } from "../run/computer.js";
import { loadRunPlugins, runPluginReferences } from "../run/run-plugins.js";
import { sessionHasRun } from "./has-run.js";

type SessionDesc = typeof SessionSchema;

/** The computer `session`'s pinned agent version gives it. */
export async function sessionComputer(store: Store, session: Session): Promise<Computer> {
  const spec = await readRunAgentSpec(
    store,
    session.status?.agentId ?? "",
    session.status?.agentVersionHash ?? "",
  );
  return agentComputer(spec);
}

/**
 * Refuses `session` (its status.computer already stamped) when it has no
 * computer and adds anything that needs one; returns otherwise.
 */
export async function refuseSessionWithoutComputer(store: Store, session: Session): Promise<void> {
  if (hasComputer(session.status?.computer)) {
    return;
  }
  const org = session.metadata?.org ?? "";
  const plugins = await loadRunPlugins(store, runPluginReferences(undefined, session, org), org);
  refuseConversationWithoutComputer(session, session.spec?.agentRef?.slug ?? "", plugins);
}

/** Stamps `session`'s computer from its pinned agent version, then refuses what it may not add. */
export async function resolveSessionComputer(store: Store, session: Session): Promise<void> {
  const status = (session.status ??= create(SessionStatusSchema));
  status.computer = await sessionComputer(store, session);
  await refuseSessionWithoutComputer(store, session);
}

export function newResolveSessionComputerStep(store: Store): PipelineStep<SessionDesc> {
  return {
    name: "ResolveSessionComputer",
    async execute(ctx: RequestContext<SessionDesc>): Promise<void> {
      const session = ctx.newState;
      const stored = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
      if (stored !== undefined && (await sessionHasRun(store, ctx, stored))) {
        const status = (session.status ??= create(SessionStatusSchema));
        status.computer = stored.status?.computer ?? Computer.UNSPECIFIED;
        await refuseSessionWithoutComputer(store, session);
        return;
      }
      await resolveSessionComputer(store, session);
    },
  };
}
