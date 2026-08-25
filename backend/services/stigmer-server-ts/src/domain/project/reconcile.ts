/**
 * Project membership reconciliation — ports pkg/domain/project/reconcile/
 * (service.go, execution_engine.go, reconciliation_{result,options,error}.go).
 * Proven by __tests__/reconcile.test.ts and the apply→prune composed arms in
 * __tests__/project.composed.test.ts.
 *
 * Apply compares the previous project's spec.members with the newly persisted
 * spec.members, both keyed "{kind}:{slug}" (the kind's enum NAME — Go's %s).
 * Members only in the current list are ADDED; members only in the previous
 * list are ORPHANS and, with pruning enabled, are deleted through the four
 * downstream domains' in-process clients — their FULL delete pipelines, so a
 * referentially-blocked orphan fails exactly as an external delete would.
 *
 * Error posture (Go, verified): reconcile NEVER throws. Per-orphan failures
 * are collected on the result and are log-only — ToProtoSummary carries only
 * created/deleted, so a failed orphan is simply absent from `deleted`. The
 * wire surface of this whole module is those two lists.
 *
 * Deliberately not ported (plan-gate decisions, tasks/T01_0_plan.md):
 *   - Go's nil-deleter stub arm (service.go:95-98) and the
 *     SetReconciliationService late-bind — both exist only for Go's
 *     registration-before-clients boot window; the compose root's lazy
 *     provider closes that window, so here a deleter always exists.
 *   - ResultBuilder and the DryRun/NoPrune option factories — zero non-test
 *     uses in Go; the sole production call is
 *     reconcile(previous, current, DEFAULT_RECONCILIATION_OPTIONS).
 */
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ReconciliationSummarySchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/status_pb";
import type { ReconciliationSummary } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/status_pb";

import type { Logger } from "../../boot/logger.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import type { Store } from "../../store/interface.js";

/**
 * Deletes one orphaned resource by kind and id — Go's ResourceDeleter, the
 * only execution capability the reference model needs (resources are
 * created/updated individually by the CLI; the server only deletes orphans).
 * Implemented over the four in-process command clients (boot/inprocess.ts).
 */
export interface OrphanDeleter {
  delete(kind: ApiResourceKind, resourceId: string): Promise<void>;
}

/**
 * Go ReconciliationOptions, reduced to the two flags the algorithm reads.
 * Production always passes DEFAULT_RECONCILIATION_OPTIONS; the other
 * combinations remain reachable for tests because the branches are part of
 * the ported algorithm.
 */
export interface ReconciliationOptions {
  /** When true, orphaned resources are deleted (Go default). */
  readonly pruneEnabled: boolean;
  /** When true, the plan is computed but nothing is deleted. */
  readonly dryRun: boolean;
}

export const DEFAULT_RECONCILIATION_OPTIONS: ReconciliationOptions = {
  pruneEnabled: true,
  dryRun: false,
};

/** One per-orphan failure — log-only, never wire-visible (Go, verified). */
export interface ReconciliationError {
  /** "{kind}:{slug}" of the orphan that failed. */
  readonly resourceKey: string;
  readonly message: string;
  readonly cause: unknown;
}

/** Go ReconciliationResult, as a plain immutable value. */
export interface ReconciliationResult {
  /** References in current but not previous — newly associated members. */
  readonly added: ReadonlyArray<ApiResourceReference>;
  /**
   * Orphans successfully deleted (or, on a dry run, the orphans that WOULD
   * be deleted — Go reports them in the same slot without deleting).
   */
  readonly removed: ReadonlyArray<ApiResourceReference>;
  readonly errors: ReadonlyArray<ReconciliationError>;
}

export interface ReconciliationService {
  /**
   * Compares memberships and prunes orphans per the options. NEVER throws —
   * Go's implementation always returns a nil error; failures ride
   * result.errors (and the apply handler's error-swallow arm upstream is
   * therefore defensive dead code in both editions, ported anyway).
   */
  reconcile(
    previousMembers: ReadonlyArray<ApiResourceReference>,
    currentMembers: ReadonlyArray<ApiResourceReference>,
    options: ReconciliationOptions,
  ): Promise<ReconciliationResult>;
}

export interface ReconciliationServiceDeps {
  readonly store: Store;
  /**
   * Lazy per the compose root's boot-ordering idiom: the in-process clients
   * behind the deleter exist only after routes registration completes.
   */
  readonly orphanDeleter: () => OrphanDeleter;
  readonly logger: Logger;
}

export function newReconciliationService(
  deps: ReconciliationServiceDeps,
): ReconciliationService {
  return {
    async reconcile(previousMembers, currentMembers, options) {
      const previousSet = buildReferenceSet(previousMembers);
      const currentSet = buildReferenceSet(currentMembers);

      const added = currentMembers.filter(
        (ref) => !previousSet.has(referenceKey(ref)),
      );
      const orphans = previousMembers.filter(
        (ref) => !currentSet.has(referenceKey(ref)),
      );

      if (added.length === 0 && orphans.length === 0) {
        return { added: [], removed: [], errors: [] };
      }

      // Dry run reports the orphans in `removed` WITHOUT deleting (Go
      // service.go:61-63 passes them straight through).
      if (options.dryRun) {
        return { added, removed: orphans, errors: [] };
      }

      if (!options.pruneEnabled || orphans.length === 0) {
        return { added, removed: [], errors: [] };
      }

      const { removed, errors } = await deleteOrphans(deps, orphans);
      return { added, removed, errors };
    },
  };
}

/**
 * Deletes each orphan, continuing on failure (Go deleteOrphans). Failures
 * are warned here — Go collects them onto a result nothing in production
 * reads, which leaves operators blind; the log is edition-local and the
 * wire behavior is identical.
 */
async function deleteOrphans(
  deps: ReconciliationServiceDeps,
  orphans: ReadonlyArray<ApiResourceReference>,
): Promise<{
  removed: ApiResourceReference[];
  errors: ReconciliationError[];
}> {
  const removed: ApiResourceReference[] = [];
  const errors: ReconciliationError[] = [];

  for (const ref of orphans) {
    const refKey = referenceKey(ref);

    let resourceId: string;
    try {
      resourceId = await resolveResourceId(deps.store, ref);
    } catch (cause) {
      errors.push({
        resourceKey: refKey,
        message: "failed to resolve resource for deletion",
        cause,
      });
      deps.logger.warn("reconciliation: failed to resolve orphan for deletion", {
        resource: refKey,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      continue;
    }

    try {
      await deps.orphanDeleter().delete(ref.kind, resourceId);
    } catch (cause) {
      errors.push({
        resourceKey: refKey,
        message: "failed to delete orphaned resource",
        cause,
      });
      deps.logger.warn("reconciliation: failed to delete orphaned resource", {
        resource: refKey,
        resourceId,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      continue;
    }

    removed.push(ref);
  }

  return { removed, errors };
}

/**
 * Resolves an orphan reference to its resource id — Go resolveResourceID:
 * FindByField on metadata.slug, SLUG ONLY, no org filter (the pinned
 * behavior: first match of that kind+slug across all orgs; tolerable in
 * single-tenant OSS).
 */
async function resolveResourceId(
  store: Store,
  ref: ApiResourceReference,
): Promise<string> {
  const schema = schemaForKind(ref.kind);
  let resource;
  try {
    resource = await store.findByField(
      ref.kind,
      "metadata.slug",
      ref.slug,
      schema,
    );
  } catch (cause) {
    throw new Error(
      `resource ${kindName(ref.kind)}/${ref.slug} not found: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  const id = metadataOf(resource)?.id ?? "";
  if (id === "") {
    throw new Error(`resource ${kindName(ref.kind)}/${ref.slug} has no ID`);
  }
  return id;
}

/**
 * The four member kinds the reconciler supports (Go newProtoForKind);
 * anything else is an unsupported-kind resolution error.
 */
function schemaForKind(kind: ApiResourceKind) {
  switch (kind) {
    case ApiResourceKind.agent:
      return AgentSchema;
    case ApiResourceKind.workflow:
      return WorkflowSchema;
    case ApiResourceKind.mcp_server:
      return McpServerSchema;
    case ApiResourceKind.skill:
      return SkillSchema;
    default:
      throw new Error(`unsupported resource kind: ${kindName(kind)}`);
  }
}

/**
 * "{kind}:{slug}" with the kind's enum NAME — Go fmt %s of the enum (e.g.
 * "agent:my-agent", "mcp_server:tools"). The numeric form would diverge
 * from Go's log/error copy.
 */
export function referenceKey(ref: ApiResourceReference): string {
  return `${kindName(ref.kind)}:${ref.slug}`;
}

function kindName(kind: ApiResourceKind): string {
  return ApiResourceKind[kind] ?? String(kind);
}

function buildReferenceSet(
  refs: ReadonlyArray<ApiResourceReference>,
): Set<string> {
  return new Set(refs.map(referenceKey));
}

/**
 * Go ToProtoSummary: added → created, updated ALWAYS empty (not applicable
 * in the reference model), removed → deleted. Every successful apply sets
 * the summary — even an all-empty one is a PRESENT message on the wire.
 */
export function toProtoSummary(
  result: ReconciliationResult,
): ReconciliationSummary {
  return create(ReconciliationSummarySchema, {
    created: [...result.added],
    updated: [],
    deleted: [...result.removed],
  });
}
