/**
 * The list-read-scope extension point (convergence program, pre-X1 entry
 * 20260830.01.sp.list-read-scoping; generalizes and ABSORBS the C2
 * Stage-4 ExecutionReadScope, whose two summary consumers now ride the
 * enumeration verb below). OSS list-shaped reads — the list/getByAgent
 * chains, apikey findAll, search, recent activity, the two dashboard
 * summaries — are deliberate full scans on OSS (single-user: everything
 * is yours). On a multi-tenant edition the same scans serve OTHER
 * tenants' rows, so the cloud baseline (the Java list handlers) narrows
 * every one of them to the caller's FGA-authorized id set (ListObjects
 * on can_view, public wildcards suppressed), with a second guest
 * cookie-label rule on the session and agent-execution lanes.
 *
 * This port is the ONE seam for that fork (DD-007 addendum 3: every
 * list-shaped fork rides a driver; the Authorizer keeps one verb — the
 * organizationDirectory precedent, never a second registration of an
 * OSS-served RPC). Two verbs, each with a distinct consumer family:
 *
 *   - `authorizedResourceIds` — pure enumeration, for consumers that
 *     need the id set BEFORE or WITHOUT scanned rows: the search lane
 *     (ids go into the engine query as a hard filter — pagination is
 *     engine-side, post-filtering would break it), the recent-activity
 *     merge, and the two getExecutionSummary aggregates.
 *   - `restrictListEntries` — candidates in, kept ids out, for every
 *     post-scan list lane through `restrictListByReadScope` below. The
 *     candidate metadata lets a driver apply per-row rules the id set
 *     cannot express (the cloud's guest cookie-label rule — label-driven
 *     and therefore self-limiting: it only bites rows carrying the guest
 *     label, so the uniform call is correct on every lane).
 *
 * The contract, ratified at this entry's plan gate (T01_1_review.md):
 *
 *   - No scope composed = the OSS full scan, byte-identical (the four
 *     local conformance rosters pin it; the org argument is then not
 *     consulted either).
 *   - A scope only NARROWS. It never reorders, never adds; sort/filter
 *     tails, per-lane org intersection, and empty-set semantics (empty
 *     list, proto default instance, kind-skipped) stay consumer-owned
 *     and edition-neutral.
 *   - A scope that cannot answer THROWS — never an empty set. An empty
 *     set is a REAL answer ("authorized to see nothing"); an
 *     authorization-backend outage surfaces as the pipeline's sanitized
 *     INTERNAL, exactly the Java baseline (DD-007: unavailable is never
 *     softened).
 *   - The scope receives whatever identity the call carries, including
 *     the in-process `internal` class — the driver owns that arm's
 *     semantics (the Java baseline propagates the original caller
 *     through in-process calls, so a composed driver normally never
 *     sees `internal` on these lanes).
 *   - THE SCOPE IS THE LAST PER-ROW PREDICATE IN A LANE (stigmer-cloud
 *     20260913.04 T02, Q-LB-11). Every request predicate a lane applies
 *     — the request's org, a phase, labels, a parent id, filter criteria
 *     — is a pure function of one row and the request; the scope is a
 *     pure function of one row and the caller; an intersection of
 *     per-row predicates commutes, so the order is free and the cheap
 *     ones go first: a lane offers the scope ONLY the rows its own
 *     predicates keep. Sort, page and aggregate are not per-row and stay
 *     after the scope, where they were. Why it matters: a composed
 *     driver's cost is proportional to the candidates offered (the cloud
 *     checks each one against its authorization engine), and the whole
 *     kind across every tenant is what rolled back on 2026-09-14; the
 *     request's org is tens of rows. Two idioms carry the rule and both
 *     keep their reason: a lane whose Go/Java contract org-narrows in
 *     BOTH editions (environment, memory, schedule, agent-instance,
 *     agent-share and agent-channel lists; the getBy* parent filters)
 *     applies its own filter ABOVE the helper call and passes `""`; a lane
 *     whose contract is cross-org on OSS (`agentExecution.list`,
 *     `workflowExecution.list`, `listPendingApprovals`) hands the request
 *     org to the helper, which applies it before the scope ONLY when a
 *     scope is composed — a scope-less server still returns the input
 *     untouched with the org unconsulted (the first line above). Two lanes
 *     have no org on the wire (`session.list`, `apiKey.findAll`) and offer
 *     the kind until P1 entry 12 pages them.
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "./identity.js";

/**
 * The candidate metadata a post-scan lane offers the scope — the three
 * fields the cloud driver's rules key on (id for the FGA intersection,
 * labels for the guest cookie rule; org rides along for symmetry with
 * the consumer-owned intersection, so a driver can log or assert on it).
 */
export interface ListEntryMeta {
  readonly id: string;
  readonly org: string;
  readonly labels: Readonly<Record<string, string>>;
}

/** The scope contract (single-instance point, ExtensionDrivers.listReadScope). */
export interface ListReadScope {
  /**
   * The resource ids `caller` may read for `kind` (the Java baseline:
   * FGA listAuthorizedResourceIds on can_view). An empty set is a real
   * answer — consumers map it to their lane's empty shape without
   * touching the store. A scope may throw on a kind it was never ruled
   * to serve (a consumer bug by contract).
   */
  authorizedResourceIds(
    caller: CallerIdentity,
    kind: ApiResourceKind,
  ): Promise<ReadonlySet<string>>;

  /**
   * The subset of `entries` ids `caller` may read for `kind` (the Java
   * baseline: the authorized-ids intersection plus the guest
   * cookie-label rule where the lane carries it). The result must be a
   * subset of the offered ids — a scope only narrows.
   */
  restrictListEntries(
    caller: CallerIdentity,
    kind: ApiResourceKind,
    entries: ReadonlyArray<ListEntryMeta>,
  ): Promise<ReadonlySet<string>>;
}

/**
 * The shape every stored API resource message presents to the shared
 * helper — the metadata fields the scope's candidates are built from.
 */
export interface ScopedListResource {
  metadata?: {
    id?: string;
    org?: string;
    labels?: Record<string, string>;
  };
}

/**
 * The ONE consumption idiom for post-scan lanes (the shared-step
 * discipline of pipeline/steps/authorization-tuples.ts, rendered as a
 * helper because half the lanes are direct handlers):
 *
 *   - no scope composed → the input array unchanged (byte-identity;
 *     `requestOrg` deliberately not consulted — the OSS single-tenant
 *     posture treats the org field as a no-op, and new filtering on a
 *     scope-less server would be a silent wire change);
 *   - scope composed → entries narrowed to `requestOrg` when non-blank
 *     FIRST (the Java repos' uniform posture: blank org =
 *     permission-bounded across orgs, verified per lane in the entry's
 *     census — lanes Java does not org-narrow pass ""), then to the kept
 *     ids. The same set either way (both are per-row predicates); the
 *     order is the header's last contract line: the scope sees the org's
 *     rows, not the kind's.
 */
export async function restrictListByReadScope<T extends ScopedListResource>(
  scope: ListReadScope | undefined,
  caller: CallerIdentity,
  kind: ApiResourceKind,
  resources: ReadonlyArray<T>,
  requestOrg: string,
): Promise<T[]> {
  if (scope === undefined) {
    return [...resources];
  }
  const offered =
    requestOrg === ""
      ? resources
      : resources.filter((resource) => resource.metadata?.org === requestOrg);
  const entries: ListEntryMeta[] = offered.map((resource) => ({
    id: resource.metadata?.id ?? "",
    org: resource.metadata?.org ?? "",
    labels: resource.metadata?.labels ?? {},
  }));
  const keptIds = await scope.restrictListEntries(caller, kind, entries);
  return offered.filter((resource) => keptIds.has(resource.metadata?.id ?? ""));
}
