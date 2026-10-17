/**
 * An agent's routines go with the agent. CascadeDeleteRoutines runs in the
 * agent's delete chain and its kind purge: every routine in the agent's own
 * organization whose spec.agent.agent_ref holds the agent's id, read
 * through the routine list index, is removed before the agent's row, with
 * what the routine's own delete removes (controller.ts `deleteRoutine`):
 * the row, its names, its access, its Temporal artifact and its fire
 * ledger. A routine left behind would fire against a missing agent and
 * pause itself; nothing it could still run exists.
 *
 * The artifact teardown and the ledger removal are best-effort, as in the
 * routine's own delete: an orphaned artifact cannot fire past the tick's
 * revalidation and the reconciliation pass reaps it, and orphaned ledger
 * rows answer no query and are pruned by retention.
 *
 * A routine in another organization cannot name this agent (a routine
 * lives in its agent's organization), and one written otherwise is that
 * organization's resource: it is left to fail closed through its dangling
 * reference.
 *
 * A routine created while its agent is being deleted removes itself when
 * its re-read after the write finds the agent gone
 * (EnsureRoutineAgentStillExists). The re-read narrows the race, it does
 * not close it, as for channels (domain/channel/cascade.ts).
 *
 * Proven by domain/agent/__tests__/agent.test.ts (the agent's delete) and
 * __tests__/cascade.test.ts.
 */
import { fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { RoutineSchema } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { internalError, notFoundError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { cleanUpDeletedResource } from "../../pipeline/steps/authorization-tuples.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { releaseNamesOfDeleted } from "../../pipeline/steps/names.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { ClockProvider } from "./clock.js";
import { routineListIndex } from "./list-index.js";

export interface RoutineCascadeDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The scheduling runtime the artifacts are torn down through. */
  readonly clock: ClockProvider;
}

/** Every routine whose spec.agent.agent_ref holds the agent's id, newest first. */
async function listRoutinesOfAgent(store: Store, logger: Logger, agentId: string): Promise<Routine[]> {
  const rows = await store.queryResources(routineListIndex, {
    anyKey: [{ name: "agent", value: agentId }],
  });
  const routines: Routine[] = [];
  for (const row of rows) {
    try {
      routines.push(fromBinary(RoutineSchema, row.data));
    } catch (error) {
      logger.warn("skipped a routine row that does not decode", {
        routineId: row.id,
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return routines.filter((routine) => (routine.spec?.agent?.agentRef?.id ?? "") === agentId);
}

export function newCascadeDeleteRoutinesStep<Desc extends DescMessage>(
  deps: RoutineCascadeDeps,
): PipelineStep<Desc> {
  return {
    name: "CascadeDeleteRoutines",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const agent = ctx.get(EXISTING_RESOURCE_KEY) as Agent | undefined;
      if (agent === undefined) {
        throw internalError(
          new Error("agent not found in context (LoadExistingForDelete must run first)"),
          "agent not found in context (LoadExistingForDelete must run first)",
        );
      }
      const agentId = agent.metadata?.id ?? "";
      const agentOrg = agent.metadata?.org ?? "";
      if (agentId === "") {
        return;
      }
      let routines: Routine[];
      try {
        routines = await listRoutinesOfAgent(deps.store, deps.logger, agentId);
      } catch (error) {
        throw internalError(error, "failed to list the agent's routines for cascade delete");
      }
      let deleted = 0;
      for (const routine of routines) {
        if ((routine.metadata?.org ?? "") !== agentOrg) {
          continue;
        }
        await deleteRoutineOfAgent(deps, routine, ctx.callerIdentity);
        deleted++;
      }
      if (deleted > 0) {
        deps.logger.info("Cascade-deleted routines of agent", {
          count: deleted,
          agent: `${agentOrg}/${agent.metadata?.slug ?? ""}`,
        });
      }
    },
  };
}

/** One routine of a deleted agent: its row, its names, its access, then its artifact and fire ledger. */
async function deleteRoutineOfAgent(
  deps: RoutineCascadeDeps,
  routine: Routine,
  caller: CallerIdentity,
): Promise<void> {
  const routineId = routine.metadata?.id ?? "";
  const org = routine.metadata?.org ?? "";
  try {
    await deps.store.deleteResource(ApiResourceKind.routine, routineId);
  } catch (error) {
    if (!(error instanceof ResourceNotFoundError)) {
      throw internalError(error, `failed to cascade-delete routine ${routineId}`);
    }
  }
  await releaseNamesOfDeleted(deps.store, deps.logger, ApiResourceKind.routine, org, routineId);
  await cleanUpDeletedResource(deps.authorizationLifecycle, deps.logger, {
    kind: ApiResourceKind.routine,
    resourceId: routineId,
    orgId: org,
    caller,
  });
  const clock = deps.clock();
  if (clock !== undefined) {
    try {
      await clock.teardown(routineId);
    } catch (error) {
      deps.logger.warn(
        "Routine artifact teardown failed (non-fatal — the orphan cannot fire past revalidation and the reconciliation pass removes it)",
        { routine_id: routineId, error: error instanceof Error ? error.message : String(error) },
      );
    }
  }
  try {
    await deps.store.deleteRoutineFiresByRoutine(routineId);
  } catch (error) {
    deps.logger.warn(
      "Fire-ledger cleanup failed (non-fatal — orphaned rows answer no query; retention prunes them)",
      { routine_id: routineId, error: error instanceof Error ? error.message : String(error) },
    );
  }
}

/**
 * EnsureRoutineAgentStillExists: after the routine, its access and its
 * artifact are written, its agent is read again. An agent deleted
 * meanwhile (its delete listed its routines before this one was stored)
 * takes the routine with it, as the cascade would have, and the create
 * answers NOT_FOUND for the agent, as a create naming a missing agent does.
 */
export function newEnsureRoutineAgentStillExistsStep(
  deps: RoutineCascadeDeps,
): PipelineStep<typeof RoutineSchema> {
  return {
    name: "EnsureRoutineAgentStillExists",
    async execute(ctx: RequestContext<typeof RoutineSchema>): Promise<void> {
      const agentId = ctx.newState.spec?.agent?.agentRef?.id ?? "";
      try {
        await deps.store.getResource(ApiResourceKind.agent, agentId, AgentSchema);
        return;
      } catch (error) {
        if (!(error instanceof ResourceNotFoundError)) {
          throw internalError(error, "failed to read the routine's agent again");
        }
      }
      deps.logger.warn("a routine's agent was deleted while it was created; removing the routine", {
        routineId: ctx.newState.metadata?.id ?? "",
        agentId,
      });
      await deleteRoutineOfAgent(deps, ctx.newState, ctx.callerIdentity);
      // NormalizeReferences made the reference an id before the write, so
      // the refusal names the agent by it.
      throw notFoundError("Agent", agentId);
    },
  };
}
