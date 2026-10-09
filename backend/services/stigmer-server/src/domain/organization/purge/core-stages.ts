/**
 * The core's purge stages, in the order the runner runs them around the
 * units' stages (extensions/organization-purge.ts draws the whole order):
 *
 *   quiesce  — the organization's schedules go first (their engine
 *              artifacts and fire ledger, through the schedule purge), so
 *              nothing fires while the rest is removed; every execution
 *              that may still run is terminated; every sandbox is torn
 *              down; the side-store records keyed by the organization
 *              (pending OAuth states) are removed.
 *              Termination needs the engine only when an execution has not
 *              reached a terminal phase: a server composed with no engine
 *              has none (an execution cannot be created without one), and
 *              a server whose engine is unreachable faults the stage and
 *              waits, because removing the row of a run that may still be
 *              live would leave the run writing to nothing.
 *   content  — every kind purge, leaves first (boot/organization-purge.ts
 *              holds the order).
 *   shred    — every secret codec destroys the organization's keys
 *              (SecretService.destroyOrganization): in an edition that
 *              wraps per organization, a backup's copy can no longer be
 *              opened. Open source's codec keeps one key for the
 *              deployment, so there it destroys nothing.
 *   children — waits until no organization names this one as its parent:
 *              a parent may be deleted once every child is being deleted,
 *              and its purge finishes after theirs. A child no delete has
 *              marked (left by a fault in its create's re-read of the
 *              parent, or by a stale mark cleared) is marked here, since
 *              it cannot outlive its parent.
 *   final    — first quiesce, the units' stages and content again, to
 *              their end, for a row a create stored after its stage had
 *              passed; then the composed lifecycle's organization arm, a
 *              sweep of the search entries and fire-ledger rows that name
 *              it (the kind purges' own removals of those log a fault and
 *              go on), the organization's policy rows (failing closed),
 *              its search entry, the row, then its names, then its
 *              deletion mark. The names
 *              follow the row on purpose: while the row stands the claim
 *              rule holds them (names.ts), so the slug is free exactly when
 *              the purge is done. The mark goes last, so a crash anywhere
 *              before it leaves an organization that still answers
 *              not-found and a purge the runner finishes.
 *
 * Every stage is idempotent and answers `more` while it has work left.
 *
 * What the tests pin (__tests__/core-stages.test.ts): the quiesce
 * engine rule, the content order and batching, the children wait, and the
 * final stage's order and its recovery when the row is already gone.
 */
import { create, fromBinary } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import type { Logger } from "../../../boot/logger.js";
import type {
  OrganizationPurgeContext,
  OrganizationPurgeProgress,
  OrganizationPurgeStage,
} from "../../../extensions/organization-purge.js";
import type { ResourceAuthorizationLifecycle } from "../../../extensions/resource-authorization.js";
import { newPipeline } from "../../../pipeline/pipeline.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  RESOURCE_ID_KEY,
  newDeleteResourceStep,
} from "../../../pipeline/steps/delete.js";
import { newDeleteSearchIndexStep } from "../../../pipeline/steps/index-search.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import type { SandboxLane } from "../../../sandbox/lane.js";
import type { Store } from "../../../store/interface.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type {
  ListIndexCursor,
  ListIndexDeclaration,
} from "../../../store/list-index.js";
import type { ExecutionEngineStateProvider } from "../../run/engine.js";
import { EngineWorkflowNotFoundError } from "../../run/engine.js";
import { agentExecutionListIndex } from "../../run/list-index.js";
import { isTerminalExecutionPhase } from "../../run/phases.js";
import type { IamPolicyGrantPath } from "../../iampolicy/grant-path.js";
import { sessionListIndex } from "../../session/list-index.js";
import { newReleaseExternalIdStep } from "../children.js";
import { organizationListIndex } from "../list-index.js";
import { newRetireOrganizationSlugStep } from "../names.js";
import { newRevokeOrganizationPoliciesStep } from "../steps.js";
import type { KindPurge } from "./kind-purge.js";

/** The core stages' names, as the deletion record and the logs carry them. */
export const QUIESCE_STAGE = "quiesce";
export const CONTENT_STAGE = "content";
export const SHRED_STAGE = "shred";
export const CHILDREN_STAGE = "children";
export const FINAL_STAGE = "final";

/** The reason an execution's run is terminated with, as the engine records it. */
export const PURGE_TERMINATION_REASON = "its organization was deleted";

/** The fixed copy the quiesce stage faults with while the engine is unreachable. */
export const ENGINE_UNREACHABLE_FOR_PURGE =
  "the execution engine is unreachable, and the organization has runs that may still be live";

/** How many execution rows the quiesce stage reads per page. */
const EXECUTION_PAGE = 200;

const DONE: OrganizationPurgeProgress = { more: false };
const MORE: OrganizationPurgeProgress = { more: true };

export interface QuiesceStageDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The schedule purge: schedules go before anything else. */
  readonly schedulePurge: KindPurge;
  readonly agentEngine: ExecutionEngineStateProvider;
  readonly sandboxLane: SandboxLane;
}

export function newQuiesceStage(deps: QuiesceStageDeps): OrganizationPurgeStage {
  return {
    name: QUIESCE_STAGE,
    async run(context) {
      const schedules = await deps.schedulePurge.purge(
        context.org,
        context.caller,
      );
      if (schedules.more) {
        return MORE;
      }
      await terminateAgentExecutions(deps, context);
      await deprovisionSandboxes(deps, context);
      await deps.store.pendingOAuthStates.deleteByOrg(context.org.id);
      return DONE;
    },
  };
}

/** Every row of an indexed kind the organization owns, page by page. */
async function* organizationRows<K extends string>(
  store: Store,
  declaration: ListIndexDeclaration<K>,
  org: string,
): AsyncGenerator<Uint8Array> {
  let after: ListIndexCursor | undefined;
  for (;;) {
    const rows = await store.queryResources(declaration, {
      org,
      limit: EXECUTION_PAGE,
      ...(after === undefined ? {} : { after }),
    });
    for (const row of rows) {
      yield row.data;
    }
    if (rows.length < EXECUTION_PAGE) {
      return;
    }
    after = rows[rows.length - 1]!.cursor;
  }
}

async function terminateAgentExecutions(
  deps: QuiesceStageDeps,
  context: OrganizationPurgeContext,
): Promise<void> {
  for await (const data of organizationRows(
    deps.store,
    agentExecutionListIndex,
    context.org.id,
  )) {
    const execution: Run = fromBinary(RunSchema, data);
    if (isTerminalExecutionPhase(execution.status?.phase ?? 0)) {
      continue;
    }
    const state = deps.agentEngine();
    if (!state.connected) {
      throw new Error(ENGINE_UNREACHABLE_FOR_PURGE);
    }
    const id = execution.metadata?.id ?? "";
    try {
      await state.engine.terminateWorkflow(id, PURGE_TERMINATION_REASON);
    } catch (error) {
      if (!(error instanceof EngineWorkflowNotFoundError)) {
        throw error;
      }
    }
  }
}

/** Every session's sandbox; missing is success (the provisioner's contract). */
async function deprovisionSandboxes(
  deps: QuiesceStageDeps,
  context: OrganizationPurgeContext,
): Promise<void> {
  const lane = deps.sandboxLane;
  if (!lane.enabled) {
    return;
  }
  for await (const data of organizationRows(
    deps.store,
    sessionListIndex,
    context.org.id,
  )) {
    const id = fromBinary(SessionSchema, data).metadata?.id ?? "";
    if (id !== "") {
      await lane.provisioner.deprovisionSessionSandbox(id);
    }
  }
}

/** Every kind purge in order: one batch of the first kind with rows left per call. */
export function newContentStage(
  purges: ReadonlyArray<KindPurge>,
): OrganizationPurgeStage {
  return {
    name: CONTENT_STAGE,
    async run(context) {
      for (const purge of purges) {
        const progress = await purge.purge(context.org, context.caller);
        if (progress.more) {
          return MORE;
        }
      }
      return DONE;
    },
  };
}

/** What the shred stage destroys through: the composition's one secret facade. */
export interface OrganizationKeyShredder {
  destroyOrganization(org: string): Promise<void>;
}

export function newShredStage(
  secrets: OrganizationKeyShredder,
): OrganizationPurgeStage {
  return {
    name: SHRED_STAGE,
    async run(context) {
      await secrets.destroyOrganization(context.org.id);
      return DONE;
    },
  };
}

export function newChildrenStage(store: Store): OrganizationPurgeStage {
  return {
    name: CHILDREN_STAGE,
    async run(context) {
      const children = await store.queryResources(organizationListIndex, {
        anyKey: [{ name: "parent_org", value: context.org.id }],
      });
      if (children.length === 0) {
        return DONE;
      }
      // A child no delete has marked can sit under a parent whose purge
      // runs only after a fault (its create's re-read of the parent failed
      // after its row landed, or its own delete's mark was cleared as
      // stale). It cannot outlive its parent, so it is deleted with it, as
      // the create's re-read would have done; a child whose own delete is
      // pending is left to that delete.
      const now = new Date().toISOString();
      for (const child of children) {
        if (!(await store.organizationDeletions.isDeleting(child.id))) {
          await store.organizationDeletions.mark(child.id, now);
          await store.organizationDeletions.accept(child.id, now);
        }
      }
      return { more: true, wait: true };
    },
  };
}

export interface FinalStageDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly grantPath: IamPolicyGrantPath;
  /** The organization's lifecycle (the composed driver, or open source's role lifecycle). */
  readonly lifecycle: ResourceAuthorizationLifecycle | undefined;
  /**
   * Stages run again, to their end, before anything final (quiesce, the
   * units' stages, content): a create that passed every check before the
   * mark and stored its row after its stage passed, or a run that started
   * after quiesce, is removed before the mark goes. A sweep that answers
   * `wait` leaves the final stage to a later pass.
   */
  readonly sweepFirst?: ReadonlyArray<OrganizationPurgeStage>;
}

export function newFinalStage(deps: FinalStageDeps): OrganizationPurgeStage {
  return {
    name: FINAL_STAGE,
    async run(context) {
      for (const sweep of deps.sweepFirst ?? []) {
        // A batch at a time, as the runner would run it.
        for (;;) {
          const progress = await sweep.run(context);
          if (!progress.more) {
            break;
          }
          if (progress.wait === true) {
            return progress;
          }
        }
      }
      const id = context.org.id;
      const organization =
        (await loadOrganization(deps.store, id)) ??
        // The row is gone (a crash after its delete): the same steps run
        // on what the purge knows, and the names it can no longer read
        // are freed by the next claim that meets them.
        create(OrganizationSchema, {
          metadata: { id },
          spec: { parentOrg: context.org.parentOrg },
        });
      if (deps.lifecycle !== undefined) {
        await deps.lifecycle.onResourceDeleted({
          kind: ApiResourceKind.organization,
          resourceId: id,
          orgId: "",
          caller: context.caller,
        });
      }
      type DeleteInput = typeof OrganizationCommandController.method.delete.input;
      const ctx = new RequestContext(
        OrganizationCommandController.method.delete.input,
        create(OrganizationCommandController.method.delete.input, {
          value: id,
        }),
        context.caller,
        ApiResourceKind.organization,
      );
      ctx.set(RESOURCE_ID_KEY, id);
      ctx.set(EXISTING_RESOURCE_KEY, organization);
      // The kind purges remove each row's search entry and each schedule's
      // fire ledger through steps that log a fault and go on; both tables
      // name the organization, so a sweep here leaves neither behind.
      await deps.store.deleteSearchIndexByOrg(id);
      await deps.store.deleteScheduleFiresByOrg(id);
      await newPipeline<DeleteInput>("organization-purge-final", deps.logger)
        .addStep(newRevokeOrganizationPoliciesStep<DeleteInput>(deps.grantPath))
        .addStep(newDeleteSearchIndexStep(deps.store, deps.logger))
        .addStep(newDeleteResourceStep(deps.store))
        .addStep(newRetireOrganizationSlugStep<DeleteInput>(deps.store, deps.logger))
        .addStep(newReleaseExternalIdStep<DeleteInput>(deps.store, deps.logger))
        .build()
        .execute(ctx);
      await deps.store.organizationDeletions.release(id);
      return DONE;
    },
  };
}

async function loadOrganization(
  store: Store,
  id: string,
): Promise<Organization | undefined> {
  try {
    return await store.getResource(
      ApiResourceKind.organization,
      id,
      OrganizationSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}
