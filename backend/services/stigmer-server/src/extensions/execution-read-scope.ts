/**
 * The execution-read-scope extension point (convergence program C2,
 * 20260827.10; Stage-4 gate ruling). The two dashboard summary reads —
 * AgentExecutionQueryController.getExecutionSummary and
 * WorkflowExecutionQueryController.getExecutionSummary — are deliberate
 * direct full-scan aggregates on OSS (single-user: everything is yours,
 * the request's org is not even consulted). On a multi-tenant edition the
 * same scan aggregates OTHER tenants' executions into the dashboard
 * numbers, so the cloud baseline (the Java GetExecutionSummary handlers)
 * scopes the aggregation to the caller's authorized id set intersected
 * with the requested org, and answers the proto DEFAULT INSTANCE when the
 * authorized set is empty — which is exactly the conformance-pinned
 * multi-tenant zero shape (success_rate 0, no cost summary), falling out
 * of the scoping rather than being special-cased.
 *
 * This port is the ONE seam for that fork (the organizationDirectory
 * precedent — never a second registration of an OSS-served RPC):
 *
 *   - No scope composed = the OSS full scan, byte-identical (the four
 *     conformance rosters pin it).
 *   - A composed scope answers the caller's authorized execution ids for
 *     the kind; the SUMMARY HANDLERS own everything else — the org
 *     intersection, the empty-set default instance, and the aggregation
 *     itself stay OSS-owned and edition-neutral.
 *
 * The scope receives whatever identity the call carries, including the
 * in-process `internal` class — the driver owns that arm's semantics
 * (the Java baseline propagates the original caller through in-process
 * calls, so a composed driver normally never sees `internal` on this
 * lane).
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "./identity.js";

/** The scope contract (single-instance point, ExtensionDrivers.executionReadScope). */
export interface ExecutionReadScope {
  /**
   * The execution ids `caller` may read for `kind` (the Java baseline:
   * FGA listAuthorizedResourceIds on can_view). An empty set is a real
   * answer — the summary handlers map it to the default instance without
   * touching the store. `kind` is agent_execution or workflow_execution;
   * a scope may throw on any other kind (a consumer bug by contract).
   */
  authorizedExecutionIds(
    caller: CallerIdentity,
    kind: ApiResourceKind,
  ): Promise<ReadonlySet<string>>;
}
