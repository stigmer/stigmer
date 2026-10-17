/**
 * CascadeDeleteEvalRuns: a subject's delete (an agent's or a plugin's)
 * removes the eval runs about it before its row goes, each with its tries'
 * conversations (tries.ts), read through the eval run list index by the
 * subject's key. Each eval run's access goes with its row while the
 * subject still links it to its organization, as the agent's scoring rule
 * cascade does (domain/scoring-rule/cascade.ts). An eval run still pending or
 * running refuses the delete, naming cancel: its tries may hold an active
 * run, which a conversation's delete refuses. Runs before every other
 * cascade of the subject's delete, so a refusal removes nothing. A plugin
 * an agent's eval run only compares is no subject: its delete leaves the
 * eval run and its results.
 *
 * An eval run created during its subject's delete meets a subject already
 * gone at its own re-read and removes itself (steps.ts
 * EnsureEvalRunSubjectStillExists). A plugin's delete also sweeps after its
 * row goes (SweepEvalRunsAfterDelete), each eval run's workflow first
 * asked to cancel and waited for; one still running after the wait is
 * deleted all the same, so no eval run outlives its plugin: its workflow
 * then finds no row, and its writes do nothing. A composition that serves
 * no eval runs passes no deps, and the steps do nothing.
 *
 * Proven by __tests__/eval-run.test.ts (the subjects' deletes) and
 * __tests__/cascade.test.ts (the race with a create).
 */
import type { DescMessage } from "@bufbuild/protobuf";

import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import type { EvalRun } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { failedPreconditionError, internalError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { cleanUpDeletedResource } from "../../pipeline/steps/authorization-tuples.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { evalRunActiveOnSubjectDeleteMessage } from "./constants.js";
import { listEvalRuns } from "./queries.js";
import { isActiveEvalRun } from "./steps.js";
import type { EvalPhaseRow } from "./steps.js";
import { deleteEvalRunTries } from "./tries.js";
import type { TrySessionDeleter } from "./tries.js";
import type { EvalRunSubject } from "./subject.js";
import type { EvalRunWorkflows } from "./workflows.js";
import { releaseNamesOfDeleted } from "../../pipeline/steps/names.js";

export interface EvalRunCascadeDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** Resolved at call time: the in-process clients are wired after the routes. */
  readonly sessions: () => TrySessionDeleter;
  /** The eval run workflows' port; absent, the sweep stops none (each finds no row to write to). */
  readonly workflows?: EvalRunWorkflows;
  /** How the sweep waits for a cancelled eval run to end; defaults to SWEEP_END_WAIT. Tests shorten it. */
  readonly endWait?: SweepEndWait;
}

/** How often the sweep reads a cancelled eval run's phase, and for how long, in milliseconds. */
export interface SweepEndWait {
  readonly pollMs: number;
  readonly maxMs: number;
}

/**
 * The sweep's wait for a cancelled eval run's workflow to end: long enough
 * for its tries to stop their runs (each waits up to two minutes for its
 * run), short enough to bound the plugin's delete.
 */
export const SWEEP_END_WAIT: SweepEndWait = { pollMs: 2_000, maxMs: 120_000 };

/** The subject being deleted, from the delete chain's loaded row. */
function deletedSubject<Desc extends DescMessage>(ctx: RequestContext<Desc>, kind: EvalRunSubject["kind"]): EvalRunSubject {
  const row = ctx.get(EXISTING_RESOURCE_KEY) as { readonly metadata?: { readonly id: string } } | undefined;
  if (row === undefined) {
    throw internalError(
      new Error(`${kind} not found in context (LoadExistingForDelete must run first)`),
      `${kind} not found in context (LoadExistingForDelete must run first)`,
    );
  }
  return { kind, id: row.metadata?.id ?? "" };
}

export function newCascadeDeleteEvalRunsStep<Desc extends DescMessage>(
  kind: EvalRunSubject["kind"],
  deps: EvalRunCascadeDeps | undefined,
): PipelineStep<Desc> {
  return {
    name: "CascadeDeleteEvalRuns",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (deps === undefined) {
        return;
      }
      const subject = deletedSubject(ctx, kind);
      let evalRuns: EvalRun[];
      try {
        evalRuns = await listEvalRuns(deps.store, deps.logger, subject);
      } catch (error) {
        throw internalError(error, `failed to list the ${kind}'s eval runs for cascade delete`);
      }
      const active = evalRuns.find(isActiveEvalRun);
      if (active !== undefined) {
        throw failedPreconditionError(evalRunActiveOnSubjectDeleteMessage(kind, active.metadata?.id ?? ""));
      }
      for (const evalRun of evalRuns) {
        await deleteEvalRun(deps, ctx, evalRun, subject);
      }
    },
  };
}

/**
 * SweepEvalRunsAfterDelete: after the subject's row is gone (and before
 * its access is cleaned), its eval runs are listed again and each one
 * found is deleted the cascade's way, whatever its phase: an eval run
 * created while the delete ran. A pending or running one's workflow is
 * first asked to cancel, as the organization purge's StopEvalRun does, so a
 * workflow the racing create started stops starting tries; when it took
 * the cancel, the sweep waits for the eval run to end (SWEEP_END_WAIT, its
 * phase polled), since a try's session refuses its delete while its run is
 * active. With create's own re-read of the subject after it stores the
 * eval run (steps.ts EnsureEvalRunSubjectStillExists), an eval run created
 * during its subject's delete is swept: one stored before this list is
 * found here, and one stored after it meets a subject already gone and
 * deletes itself. One still running after the wait is deleted all the
 * same, once its workflow took the cancel (a warning names it): the
 * workflow's record and finish find no row and write nothing, its tries
 * stop their runs, and a try whose session still refuses its delete is
 * left, logged. So no eval run outlives its subject.
 */
export function newSweepEvalRunsAfterDeleteStep<Desc extends DescMessage>(
  kind: EvalRunSubject["kind"],
  deps: EvalRunCascadeDeps | undefined,
): PipelineStep<Desc> {
  return {
    name: "SweepEvalRunsAfterDelete",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (deps === undefined) {
        return;
      }
      const subject = deletedSubject(ctx, kind);
      let evalRuns: EvalRun[];
      try {
        evalRuns = await listEvalRuns(deps.store, deps.logger, subject);
      } catch (error) {
        throw internalError(error, `failed to list the ${kind}'s eval runs after its delete`);
      }
      for (const evalRun of evalRuns) {
        const evalRunId = evalRun.metadata?.id ?? "";
        deps.logger.warn("an eval run was created while its subject was deleted; deleting it", {
          evalRunId,
          subject: `${kind} ${subject.id}`,
        });
        const asked = await askEvalRunToStop(
          deps.workflows,
          deps.logger,
          evalRun,
          "a swept eval run's workflow could not be cancelled",
        );
        const ended = !asked || (await awaitEvalRunEnd(deps.store, evalRunId, deps.endWait ?? SWEEP_END_WAIT));
        if (!ended) {
          deps.logger.warn("a swept eval run's workflow has not ended; deleting it all the same", {
            evalRunId,
            subject: `${kind} ${subject.id}`,
          });
        }
        await deleteEvalRun(deps, ctx, evalRun, subject, { leaveRefused: !ended });
      }
    },
  };
}

/**
 * A pending or running eval run's workflow asked to cancel, best effort: a
 * workflow that outlives the eval run's row finds no row to write to. A cancel
 * that fails is logged with `failedMessage`. Answers whether a running
 * workflow took the cancel, so a caller may wait for it to end.
 */
export async function askEvalRunToStop(
  workflows: EvalRunWorkflows | undefined,
  logger: Logger,
  evalRun: EvalPhaseRow & { readonly metadata?: { readonly id: string } },
  failedMessage: string,
): Promise<boolean> {
  if (workflows === undefined || !isActiveEvalRun(evalRun)) {
    return false;
  }
  const evalRunId = evalRun.metadata?.id ?? "";
  try {
    return (await workflows.cancel(evalRunId)) === "requested";
  } catch (error) {
    logger.warn(failedMessage, {
      evalRunId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Whether the eval run ended (no longer pending or running, or gone) within
 * `wait`, its phase read every `wait.pollMs`. A read that fails counts as
 * not ended yet.
 */
async function awaitEvalRunEnd(store: Store, evalRunId: string, wait: SweepEndWait): Promise<boolean> {
  const deadline = Date.now() + wait.maxMs;
  for (;;) {
    try {
      const live = await store.getResource(ApiResourceKind.eval_run, evalRunId, EvalRunSchema);
      if (!isActiveEvalRun(live)) {
        return true;
      }
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return true;
      }
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, wait.pollMs));
  }
}

/** One eval run of a deleted subject: its tries' conversations (those refused left, when told), its row, then its access. */
async function deleteEvalRun<Desc extends DescMessage>(
  deps: EvalRunCascadeDeps,
  ctx: RequestContext<Desc>,
  evalRun: EvalRun,
  subject: EvalRunSubject,
  tries: { readonly leaveRefused?: boolean } = {},
): Promise<void> {
  const evalRunId = evalRun.metadata?.id ?? "";
  await deleteEvalRunTries(deps.store, deps.sessions(), deps.logger, evalRunId, tries);
  try {
    await deps.store.deleteResource(ApiResourceKind.eval_run, evalRunId);
  } catch (error) {
    throw internalError(error, `failed to cascade-delete eval run ${evalRunId} of ${subject.kind} ${subject.id}`);
  }
  await releaseNamesOfDeleted(deps.store, deps.logger, ApiResourceKind.eval_run, evalRun.metadata?.org ?? "", evalRunId);
  await cleanUpDeletedResource(deps.authorizationLifecycle, deps.logger, {
    kind: ApiResourceKind.eval_run,
    resourceId: evalRunId,
    orgId: evalRun.metadata?.org ?? "",
    caller: ctx.callerIdentity,
  });
}
