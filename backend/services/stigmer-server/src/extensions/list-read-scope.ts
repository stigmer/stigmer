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
 * on can_view), with a second guest
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
 *     consulted either). That is the trusted-local posture. Under the
 *     built-in authorization posture (src/authorization/posture.ts — an
 *     authentication posture with no unit Authorizer) open source
 *     composes its own scope (src/authorization/list-read-scope.ts): the
 *     cloud's model, evaluated per candidate over the facts the candidate
 *     carries, so a self-host's lists show a person what a `get` would
 *     let them read. A unit's registered scope wins in every posture.
 *   - A scope only NARROWS. It never reorders, never adds; sort/filter
 *     tails, per-lane org intersection, and empty-set semantics (empty
 *     list, proto default instance, kind-skipped) stay consumer-owned
 *     and edition-neutral.
 *   - A scope that cannot answer THROWS — never an empty set. An empty
 *     set is a REAL answer ("authorized to see nothing"); an
 *     authorization-backend outage surfaces as the pipeline's sanitized
 *     INTERNAL, exactly the Java baseline (DD-007: unavailable is never
 *     softened).
 *   - THE `internal` CLASS IS ANSWERED HERE, NEVER OFFERED TO
 *     `restrictListEntries`. The server acting as itself over the
 *     in-process transport (boot/inprocess.ts mints the class; nothing
 *     else can) is the server's own trust domain, on list lanes exactly
 *     as on the Authorize step, which returns for the class before any
 *     Authorizer is asked (pipeline/steps/authorize.ts). The helper
 *     below returns the org-narrowed rows for that class before the
 *     scope is consulted. The rule is class-only, like the step's: a
 *     caller PROPAGATED through the in-process header keeps its own
 *     class and stays scoped. Why here and not in a driver: a driver
 *     answering "every offered id" for the class must be written once
 *     per edition and is a silent short list the day one edition
 *     forgets (stigmer#1207: a composed driver scoped the class and
 *     every server-internal list read came back empty — the
 *     personal-environment reads at execution-context creation and MCP
 *     connect in this repository, and a composition's own in-process
 *     readers of a session's executions).
 *     The enumeration verb is a wire caller's verb: no in-process edge
 *     reaches `authorizedResourceIds`, and only a scanning driver can
 *     say "all", so that verb's internal arm stays the driver's and is
 *     stated in its doc below.
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
 *     request's org is tens of rows. The lanes over the session, execution
 *     and artifact kinds narrow by the request's org or parent in the
 *     store's indexed read (store/list-index.ts; every posture honours the
 *     request) and page there (pipeline/steps/list-page.ts, one batch per
 *     scope call), passing `""`; the small org-scoped lists (environment,
 *     memory, schedule, agent-instance, agent-share and agent-channel; the
 *     getBy* parent filters) apply their own filter above the helper call
 *     and pass `""` too. `apiKey.findAll` has no org on the wire and offers
 *     the kind: a few rows per person.
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
 *   - EVERY CANDIDATE CARRIES THE ROW'S AUTHORIZATION FACTS (the
 *     built-in scope's entry): the creator stamp, the visibility level
 *     and every parent link the tuple lifecycle would have written — the
 *     `RowAuthorizationFacts` the row's tuples derive from, read by the
 *     one structural resolver the built-in authorizer reads a loaded row
 *     through (pipeline/steps/authorization-facts.ts). A driver that
 *     evaluates the model over a candidate therefore needs no second
 *     read of a row the lane already decoded; a driver that asks an
 *     engine ignores the facts and is byte-neutral. The facts are
 *     REQUIRED on the candidate, never optional: both are always on the
 *     row the helper holds, and an optional field would let a driver
 *     silently skip the check.
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { ApiResourceAudit } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

// The only VALUE imports from extensions/ into pipeline/ (every other
// crossing is a type): three pure leaf modules that import nothing but
// protos and each other, so there is no cycle. Deliberate — one resolver
// for the tuple writer, the point-check driver and the list reader beats
// a copy in the seam.
import {
  inheritedAuthorizationParentOf,
  kindEnumName,
} from "../pipeline/apiresource-meta.js";
import { rowAuthorizationFactsOf } from "../pipeline/steps/authorization-facts.js";

import type { CallerIdentity } from "./identity.js";
import type {
  ResolvedParentLink,
  RowAuthorizationFacts,
} from "./resource-authorization.js";

/**
 * The candidate a post-scan lane offers the scope: the row's authorization
 * facts (the header's last contract line), the labels the cloud driver's
 * guest cookie rule keys on (org rides along in the facts for symmetry
 * with the consumer-owned intersection, so a driver can log or assert on
 * it), and the parent for kinds whose authorization is their parent's.
 */
export interface ListEntryMeta extends RowAuthorizationFacts {
  readonly labels: Readonly<Record<string, string>>;
  /**
   * OPTIONAL (added 20260913.04 T04): the parent this row's authorization
   * IS — present only for a kind whose `kind_meta` is PARENT scope with
   * INHERITED owner (the header's contract line), the same
   * `ResolvedParentLink` the tuple lifecycle wrote for the row and one of
   * the candidate's own `parentLinks`, named again as the designation a
   * driver may answer in place of the child. Absent for every other kind,
   * and absent when the row's spec does not name its parent — a driver
   * then asks about the row itself, never drops it.
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
   *
   * The `internal` class CAN reach this verb (no helper stands between a
   * consumer and it), and the driver owns that arm: a scanning driver
   * answers every id of the kind, an engine-backed one answers what its
   * engine holds for the class. No in-process edge reaches an
   * enumeration lane today, so the two answers have never met a caller;
   * a consumer that adds one reads this line first.
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
   *
   * `caller` is never the `internal` class: `restrictListByReadScope`,
   * the one consumption idiom, answers that class before any driver is
   * asked (the header's contract line). A driver that is offered it has
   * been reached around the idiom and refuses with
   * `InternalCallerOfferedError` rather than evaluate the server as a
   * person.
   */
  restrictListEntries(
    caller: CallerIdentity,
    kind: ApiResourceKind,
    entries: ReadonlyArray<ListEntryMeta>,
  ): Promise<ReadonlySet<string>>;
}

/**
 * The restrict verb's refusal of the `internal` class (its doc above):
 * thrown by a driver that is offered the server acting as itself, which
 * `restrictListByReadScope` answers before any driver is asked. Being
 * offered it means a list lane reached the driver around that idiom, and
 * evaluating the server as a person would answer a quiet short list, the
 * failure stigmer#1207 fixed. It is a consumer bug, never a denial (a
 * denial is an empty set): the lane faults and the pipeline answers its
 * sanitized INTERNAL. One type for every edition's driver, so each refuses
 * the class the same way.
 */
export class InternalCallerOfferedError extends Error {
  readonly kind: ApiResourceKind;

  constructor(kind: ApiResourceKind) {
    super(
      `the internal caller class was offered to the list scope for kind '${kindEnumName(kind)}' — the shared helper answers that class before any driver; a list lane reached the driver around it`,
    );
    this.name = "InternalCallerOfferedError";
    this.kind = kind;
  }
}

/**
 * The shape every stored API resource message presents to the shared
 * helper — the metadata fields the scope's candidates are built from, the
 * spec the parents are read from (structurally, by `kind_meta`'s
 * `spec_field`; typed loosely because the field differs per kind and the
 * read is `parentIdOf`'s), and the audit the creator stamp is read from
 * (the one generated type every kind's status carries it as).
 */
export interface ScopedListResource {
  metadata?: {
    id?: string;
    org?: string;
    labels?: Record<string, string>;
    visibility?: ApiResourceVisibility;
  };
  spec?: object;
  status?: { audit?: ApiResourceAudit };
}

/**
 * The ONE consumption idiom for post-scan lanes (the shared-step
 * discipline of pipeline/steps/authorization-tuples.ts, rendered as a
 * helper because half the lanes are direct handlers; on the barrel, so a
 * composition's lane over its own table narrows the same way):
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
 *     order is the header's contract line: the scope sees the org's
 *     rows, not the kind's;
 *   - scope composed, caller `internal` → the org-narrowed rows, the
 *     scope never asked and no candidate built (the header's contract
 *     line). The org predicate is the REQUEST's, not the caller's, so
 *     the server's own read of a cross-org lane still honours the org
 *     it asked for; only the caller predicate is skipped;
 *   - every candidate carries the row's authorization facts, and the
 *     candidates of a kind whose authorization is its parent's name that
 *     parent again as `authorizationParent` — one of the facts' parent
 *     links, picked by the relation `kind_meta` declares, resolved once
 *     per call and read once per row.
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
  // The server acting as itself: the trust-domain rule of the Authorize
  // step, applied to a list answer — the caller predicate is skipped, the
  // request's org predicate above is not (the header's contract line).
  if (caller.callerClass === "internal") {
    return [...offered];
  }
  const parentOf = authorizationParentReader(kind);
  const entries: ListEntryMeta[] = offered.map((resource) => {
    const entry: ListEntryMeta = {
      ...rowAuthorizationFactsOf(kind, resource),
      labels: resource.metadata?.labels ?? {},
    };
    const authorizationParent = parentOf(entry.parentLinks);
    return authorizationParent === undefined
      ? entry
      : { ...entry, authorizationParent };
  });
  const keptIds = await scope.restrictListEntries(caller, kind, entries);
  return offered.filter((resource) => keptIds.has(resource.metadata?.id ?? ""));
}

/**
 * The per-row parent picker for `kind`: a constant `undefined` for the 27
 * kinds whose authorization is their own, and for the kind whose
 * authorization is its parent's, the link among the row's own parent
 * links that carries the declared relation — or undefined for a row whose
 * spec does not name it (never a throw: a list is not a create).
 * `kind_meta` is consulted once per call, not once per row.
 */
function authorizationParentReader(
  kind: ApiResourceKind,
): (
  parentLinks: ReadonlyArray<ResolvedParentLink>,
) => ResolvedParentLink | undefined {
  const parent = inheritedAuthorizationParentOf(kind);
  if (parent === undefined) {
    return () => undefined;
  }
  return (parentLinks) =>
    parentLinks.find((link) => link.relation === parent.relation);
}
