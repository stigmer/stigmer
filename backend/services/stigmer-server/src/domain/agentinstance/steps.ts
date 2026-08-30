/**
 * AgentInstance domain-local pipeline steps — port the inline steps of
 * pkg/domain/agentinstance/controller/ (create.go, update.go,
 * update_visibility.go, list.go, get_by_agent.go). Shared steps stay in
 * src/pipeline/steps/; these exist because they embody instance-specific
 * contracts: the parent-agent edge, the immutable agent_id, the
 * default-instance visibility guard, and the org/label list filters.
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentInstanceListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/io_pb";
import { AgentInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { isDefaultInstance } from "../../pipeline/apiresource-labels.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import {
  compareCreatedAtDesc,
  matchesAllLabels,
} from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { rejectDefaultInstanceVisibilityUpdate } from "../../pipeline/steps/validate-visibility.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

/**
 * The narrow in-process surface the agentinstance domain needs from agent —
 * consumer-defined so the dependency reads at the domain boundary (the Go
 * twin is pkg/downstream/agent.Client). Calls ride the in-process router
 * transport, traversing the full interceptor chain (DD-002).
 */
export interface ParentAgentLoader {
  get(agentId: string): Promise<Agent>;
}

/**
 * Lazy provider for the agent↔agentinstance true cycle — resolved at call
 * time, never at construction (the ratified DI story, D2 §2).
 */
export type ParentAgentLoaderProvider = () => ParentAgentLoader;

/**
 * LoadParentAgent — create.go: an unknown spec.agent_id is rejected with
 * NotFound instead of persisting a dangling instance (oss#645), converging
 * on cloud's LoadParentAgent step and this server's own WorkflowInstance
 * create pipeline.
 *
 * Unlike its WorkflowInstance twin, the loaded agent is NOT stored in the
 * request context: nothing downstream consumes it (cloud's consumer is the
 * FGA authorize step, which OSS excludes; the WorkflowInstance twin's
 * consumer is the same-org rule, which agent instances deliberately do not
 * have — an agent is a shareable blueprint, and one agent legitimately has
 * instances in several orgs: the marketplace case).
 */
export function newLoadParentAgentStep(
  agentLoader: ParentAgentLoaderProvider,
  logger: Logger,
): PipelineStep<typeof AgentInstanceSchema> {
  return {
    name: "LoadParentAgent",
    async execute(
      ctx: RequestContext<typeof AgentInstanceSchema>,
    ): Promise<void> {
      const agentId = ctx.input.spec?.agentId ?? "";

      logger.info("Loading parent agent", { agentId });

      let parentAgent: Agent;
      try {
        parentAgent = await agentLoader().get(agentId);
      } catch (error) {
        logger.warn("Parent agent not found", {
          agentId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw notFoundError("Agent", agentId);
      }

      logger.debug("Loaded parent agent", {
        agentId,
        org: parentAgent.metadata?.org ?? "",
      });
    },
  };
}

/**
 * ValidateInstanceUpdate — update.go: enforces the instance's immutable
 * identity on update — spec.agent_id must keep referencing the same agent.
 * An instance is a configured materialization OF one agent; repointing it
 * would silently change what its executions run while keeping the
 * instance's identity, history, and references intact — create a new
 * instance instead (oss#646).
 *
 * Rejecting (rather than silently preserving, as BuildUpdateState does for
 * metadata.visibility) is deliberate: visibility has a legitimate second
 * door — the guarded updateVisibility RPC — so stale manifests carrying an
 * old level are routine and must not fail the update. The parent ref has NO
 * other door; no manifest with a different agent_id was ever valid, so a
 * differing value is always a client error and deserves a loud failure.
 *
 * Runs after LoadExisting. Apply delegates to Update for existing
 * resources, so this guard covers the apply door too. An EMPTY request
 * agent_id never reaches this step — protovalidate pins min_len=1.
 */
export function newValidateInstanceUpdateStep(): PipelineStep<
  typeof AgentInstanceSchema
> {
  return {
    name: "ValidateInstanceUpdate",
    execute(ctx: RequestContext<typeof AgentInstanceSchema>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as
        | AgentInstance
        | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing agent instance not found in context"),
          "existing agent instance not found in context",
        );
      }

      if ((ctx.input.spec?.agentId ?? "") !== (existing.spec?.agentId ?? "")) {
        throw failedPreconditionError(
          `spec.agent_id is immutable (instance instantiates agent ${existing.spec?.agentId ?? ""}) — create a new instance for a different agent`,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// RejectDefaultInstanceVisibilityUpdate — update_visibility.go: rejects
// visibility updates on an agent's system-managed default instance — the
// OSS half of the guard the cloud edition applies in its
// ValidateVisibilityUpdateStep. Default instances carry no visibility of
// their own: their access always follows the parent agent, and a level
// stamped here would persist state the cloud edition considers structurally
// invalid (stigmer/stigmer#556).
//
// An instance counts as the default when EITHER holds: metadata carries the
// stigmer.ai/default-instance label (cloud's key — stamped at create by the
// defaultinstance factory), or the parent agent's status.default_instance_id
// points at it (the authoritative, server-owned record; covers instances
// created before OSS stamped the label, and cannot be dropped by a client
// update the way the label can — OSS has no reserved-label write guard).
//
// Deliberate divergence from cloud (label-only): the pointer branch makes
// the guard hold for pre-label legacy rows without a backfill migration.
// Deliberate non-goal: UpdateExecutionVisibility (spec.execution_visibility,
// run observability) is NOT guarded — cloud allows it on default instances.
// Do not "fix" that.
//
// A missing parent (orphan instance) passes through: nothing marks the
// instance default, and inventing a failure mode here would break the one
// legitimate operation an orphan supports. Any other store failure is
// INTERNAL — a transient fault must not silently open the guard.
// ---------------------------------------------------------------------------

/** Context key for the instance under visibility update. */
export const UPDATE_VISIBILITY_INSTANCE_KEY = "updateVisibilityInstance";

export function newRejectDefaultInstanceVisibilityUpdateStep<
  Desc extends DescMessage,
>(store: Store): PipelineStep<Desc> {
  return {
    name: "RejectDefaultInstanceVisibilityUpdate",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const instance = ctx.get(UPDATE_VISIBILITY_INSTANCE_KEY) as AgentInstance;

      if (isDefaultInstance(instance.metadata)) {
        rejectDefaultInstanceVisibilityUpdate();
      }

      const parentId = instance.spec?.agentId ?? "";
      if (parentId === "") {
        return;
      }
      let parent: Agent;
      try {
        parent = await store.getResource(
          ApiResourceKind.agent,
          parentId,
          AgentSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          return;
        }
        throw internalError(
          error,
          "failed to load parent agent for default-instance check",
        );
      }
      if (parent.status?.defaultInstanceId === (instance.metadata?.id ?? "")) {
        rejectDefaultInstanceVisibilityUpdate();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// List filters — list.go and get_by_agent.go. Full scans with client-side
// filtering, exactly Go (no pagination; no scope composed = no authorization
// filtering). With a composed ListReadScope (20260830.01, census lanes
// 14–15) both lanes narrow to the caller's authorized instances; the org
// filters below are contract parity in both editions.
// ---------------------------------------------------------------------------

/** Context key for the list result (Go listResultKey). */
export const LIST_RESULT_KEY = "listResult";

/** Context key for the get-by-agent result (Go "instanceList"). */
export const INSTANCE_LIST_KEY = "instanceList";

/**
 * ListByOrgAndLabels — org equality + AND-label filtering, sorted by
 * spec-audit created_at descending (seconds then nanos; timestamped
 * entries before untimestamped ones).
 */
export function newListByOrgAndLabelsStep(
  store: Store,
  logger: Logger,
  listReadScope: ListReadScope | undefined,
): PipelineStep<typeof AgentInstanceQueryController.method.list.input> {
  return {
    name: "ListByOrgAndLabels",
    async execute(
      ctx: RequestContext<
        typeof AgentInstanceQueryController.method.list.input
      >,
    ): Promise<void> {
      const { org, labels: filterLabels } = ctx.input;

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ApiResourceKind.agent_instance);
      } catch (error) {
        throw internalError(error, "failed to list agent instances");
      }

      const decoded: AgentInstance[] = [];
      for (const data of rows) {
        try {
          decoded.push(fromBinary(AgentInstanceSchema, data));
        } catch (error) {
          logger.warn("Failed to unmarshal agent instance, skipping", {
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }
      const visible = await restrictListByReadScope(
        listReadScope,
        ctx.callerIdentity,
        ApiResourceKind.agent_instance,
        decoded,
        "",
      );

      const instances: AgentInstance[] = [];
      for (const instance of visible) {
        if ((instance.metadata?.org ?? "") !== org) {
          continue;
        }
        if (!matchesAllLabels(instance.metadata?.labels ?? {}, filterLabels)) {
          continue;
        }
        instances.push(instance);
      }

      instances.sort((a, b) =>
        compareCreatedAtDesc(
          a.status?.audit?.specAudit?.createdAt,
          b.status?.audit?.specAudit?.createdAt,
        ),
      );

      logger.info("Listed agent instances", {
        org,
        matchCount: instances.length,
        labelFilters: Object.keys(filterLabels).length,
      });

      ctx.set(
        LIST_RESULT_KEY,
        create(AgentInstanceListSchema, {
          totalCount: instances.length,
          items: instances,
        }),
      );
    },
  };
}

/**
 * LoadByAgent — all instances of one agent (spec.agent_id match), scoped to
 * one org when the request carries one. The org filter is contract parity,
 * not authorization: a multi-org caller asking for one org's instances must
 * not see another org's instances of the same agent.
 */
export function newLoadByAgentStep(
  store: Store,
  listReadScope: ListReadScope | undefined,
): PipelineStep<typeof AgentInstanceQueryController.method.getByAgent.input> {
  return {
    name: "LoadByAgent",
    async execute(
      ctx: RequestContext<
        typeof AgentInstanceQueryController.method.getByAgent.input
      >,
    ): Promise<void> {
      const req = ctx.input;
      const agentId = req.agentId;

      if (agentId === "") {
        throw invalidArgumentError("agent_id is required");
      }

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ApiResourceKind.agent_instance);
      } catch (error) {
        throw internalError(error, "failed to list agent instances");
      }

      const decoded: AgentInstance[] = [];
      for (const data of rows) {
        try {
          decoded.push(fromBinary(AgentInstanceSchema, data));
        } catch {
          continue;
        }
      }
      const visible = await restrictListByReadScope(
        listReadScope,
        ctx.callerIdentity,
        ApiResourceKind.agent_instance,
        decoded,
        "",
      );

      const instances: AgentInstance[] = [];
      for (const instance of visible) {
        if ((instance.spec?.agentId ?? "") !== agentId) {
          continue;
        }
        if (req.org !== "" && (instance.metadata?.org ?? "") !== req.org) {
          continue;
        }
        instances.push(instance);
      }

      ctx.set(
        INSTANCE_LIST_KEY,
        create(AgentInstanceListSchema, {
          totalCount: instances.length,
          items: instances,
        }),
      );
    },
  };
}
