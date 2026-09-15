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
 *   - A KIND WHOSE AUTHORIZATION IS ITS PARENT'S CARRIES THAT PARENT ON
 *     EVERY CANDIDATE (stigmer-cloud 20260913.04 T04, Q-LB-33..36). When
 *     `kind_meta` declares PARENT scope with INHERITED owner
 *     (`inheritedAuthorizationParentOf`; today agent_execution → session),
 *     the helper fills `ListEntryMeta.authorizationParent` from the row's
 *     spec through the same read the tuple lifecycle wrote the parent link
 *     with. A driver MAY answer the parent's question in place of the
 *     child's: by the model's construction the two answers are identical
 *     (the child's `owner`, `viewer` and `can_view` are all `from` the
 *     parent), and the parent's resolution is direct tuples where the
 *     child's walks the parent's whole set (OpenFGA's learned `weight2`
 *     strategy read the founder's 423 sessions per execution; that is what
 *     rolled back twice on 2026-09-14). A driver that ignores the field is
 *     still correct. The one observable difference is stated, not hidden:
 *     a row whose parent tuple never landed (the create chain's "row
 *     survives, tuple write failed" state, healed by retry) is hidden by
 *     the child's check and shown by the parent's — the row's truth, read
 *     from the field the tuple was derived from, and no widening: nobody
 *     reaches a parent through it who could not create the row in it.
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

// The first VALUE imports from extensions/ into pipeline/ (every other
// crossing is a type): two pure leaf modules that import nothing but
// protos, so there is no cycle. Deliberate — one resolver for the tuple
// writer and the list reader beats a copy in the seam.
import {
  getKindEnum,
  inheritedAuthorizationParentOf,
} from "../pipeline/apiresource-meta.js";
import { parentIdOf } from "../pipeline/steps/shapes.js";

import type { CallerIdentity } from "./identity.js";
import type { ResolvedParentLink } from "./resource-authorization.js";

/**
 * The candidate metadata a post-scan lane offers the scope — the three
 * fields the cloud driver's rules key on (id for the FGA intersection,
 * labels for the guest cookie rule; org rides along for symmetry with
 * the consumer-owned intersection, so a driver can log or assert on it),
 * plus the parent for kinds whose authorization is their parent's.
 */
export interface ListEntryMeta {
  readonly id: string;
  readonly org: string;
  readonly labels: Readonly<Record<string, string>>;
  /**
   * OPTIONAL (added 20260913.04 T04): the parent this row's authorization
   * IS — present only for a kind whose `kind_meta` is PARENT scope with
   * INHERITED owner (the header's last contract line), the same
   * `ResolvedParentLink` the tuple lifecycle wrote for the row. Absent for
   * every other kind, and absent when the row's spec does not name its
   * parent — a driver then asks about the row itself, never drops it.
   */
  readonly authorizationParent?: ResolvedParentLink;
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
 * helper — the metadata fields the scope's candidates are built from, and
 * the spec the parent is read from (structurally, by `kind_meta`'s
 * `spec_field`; typed loosely because the field differs per kind and the
 * read is `parentIdOf`'s).
 */
export interface ScopedListResource {
  metadata?: {
    id?: string;
    org?: string;
    labels?: Record<string, string>;
  };
  spec?: object;
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
 *     order is the header's second-to-last contract line: the scope sees
 *     the org's rows, not the kind's;
 *   - the candidates of a kind whose authorization is its parent's carry
 *     `authorizationParent` (the header's last line), resolved once per
 *     call from `kind_meta` and once per row from the spec.
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
  const parentOf = authorizationParentReader(kind);
  const entries: ListEntryMeta[] = offered.map((resource) => {
    const entry: ListEntryMeta = {
      id: resource.metadata?.id ?? "",
      org: resource.metadata?.org ?? "",
      labels: resource.metadata?.labels ?? {},
    };
    const authorizationParent = parentOf(resource);
    return authorizationParent === undefined
      ? entry
      : { ...entry, authorizationParent };
  });
  const keptIds = await scope.restrictListEntries(caller, kind, entries);
  return offered.filter((resource) => keptIds.has(resource.metadata?.id ?? ""));
}

/**
 * The per-row parent reader for `kind`: a constant `undefined` for the 27
 * kinds whose authorization is their own, and for the kind whose
 * authorization is its parent's, the `ResolvedParentLink` the tuple
 * lifecycle wrote — or undefined for a row whose spec does not name it
 * (never a throw: a list is not a create). `kind_meta` is consulted once
 * per call, not once per row.
 */
function authorizationParentReader(
  kind: ApiResourceKind,
): (resource: ScopedListResource) => ResolvedParentLink | undefined {
  const parent = inheritedAuthorizationParentOf(kind);
  if (parent === undefined) {
    return () => undefined;
  }
  const parentKind = getKindEnum(parent.kind);
  return (resource) => {
    const parentId = parentIdOf(resource, parent.specField);
    return parentId === ""
      ? undefined
      : { relation: parent.relation, parentKind, parentId };
  };
}
