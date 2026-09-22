/**
 * The authorization-query capability (20260913.01, T01_1_review.md Q-OR-8):
 * the TUPLE half of the IamPolicy query surface — the questions only an
 * authorization engine can answer over its own graph, as opposed to the
 * ROW half (who holds which role on what) that every edition answers from
 * IamPolicy rows. Single instance, registered as
 * `drivers.authorizationQueries` (the identityFederation shape: a driver
 * point that is open source's own behaviour when absent).
 *
 * Absent, the IamPolicy query controller refuses `checkAuthorization`,
 * `listAuthorizedResourceIds`, `listAuthorizedPrincipalIds`, and a
 * `checkMyPermission` that carries contextual policies, UNIMPLEMENTED with
 * the edition reason (domain/iampolicy/constants.ts
 * AUTHORIZATION_QUERIES_UNIMPLEMENTED_MESSAGE) — never INTERNAL, the
 * organization directory's absent-method precedent. Present, the
 * controller still owns everything that is not the graph question: the
 * annotation's Authorize step, `checkAuthorization`'s principal-trust rule
 * (a user asks only about their own account; machine and internal about
 * anyone), the UNAUTHENTICATED refusal, and the plain
 * `checkMyPermission` that rides the composed Authorizer instead. The
 * engine receives boundary-validated refs and never asks who is calling.
 *
 * The engine speaks the CONTRACT's vocabulary, not a backend's (Q-S3-1,
 * 2026-09-13): `ApiResourceRef` for a principal or resource (kind = the
 * enum member name, id, and for a principal an optional relation — the
 * userset form `organization:X#member`), `IamPolicySpec` for a policy and
 * for the what-if policies every query may carry, and the relation and
 * kind strings as the wire sends them. The cloud's driver renders these to
 * OpenFGA's `type:id#relation` strings itself; that grammar belongs to the
 * store that runs it and never enters this library.
 *
 * Semantics the controller and the conformance suite rely on (the Java
 * check-handler posture the cloud's client already implements):
 *
 *   - `check` resolves usersets (a grant to `organization:acme#member`
 *     answers true for a member), so "may I read this" is the model's
 *     answer and not a lookup of who was named.
 *   - the two listings never expand usersets, and `listPrincipalIds`
 *     answers DIRECT principals only — a listing is an inventory of who
 *     was named, never a resolution of who could reach.
 *   - contextual policies are evaluated as if held, and nothing is written.
 *
 * Error doctrine (the ListReadScope rule, verbatim in spirit: a seam that
 * cannot answer THROWS — never an empty set, never false): `false` and
 * `[]` are REAL answers. A backend outage surfaces as a throw; a
 * ConnectError keeps its code (the cloud maps its three OpenFGA wire arms —
 * DEADLINE_EXCEEDED, UNAVAILABLE, INTERNAL — before throwing), any other
 * throw is INTERNAL through the pipeline's boundary. A denial dressed as
 * an outage, or an outage dressed as a denial, is the fail-open class this
 * contract exists to refuse.
 *
 * Why this is not `ListReadScope`: the read scope narrows the server's OWN
 * list lanes for the calling identity with no what-if input; this engine
 * answers the wire's explicit queries about an ARBITRARY principal with
 * contextual policies. Both are ratified seams with distinct consumers;
 * a cloud driver may wrap one client for both, and that is its business.
 */
import type {
  ApiResourceRef,
  IamPolicySpec,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

/** The query-engine contract (single-instance point, ExtensionDrivers.authorizationQueries). */
export interface AuthorizationQueryEngine {
  /**
   * Whether `policy` is effectively held — its principal has its relation
   * on its resource — given `contextualPolicies` evaluated as if held.
   * The proto's CheckAuthorizationInput shape; `checkMyPermission` builds
   * the spec from the caller's account ref. The spec's refs are present
   * (boundary-validated, or controller-built).
   */
  check(
    policy: IamPolicySpec,
    contextualPolicies: ReadonlyArray<IamPolicySpec>,
  ): Promise<boolean>;
  /**
   * The ids of `resourceKind` resources on which `principal` holds
   * `relation` (ListAuthorizedResourceIdsInput's field order). Usersets
   * are not expanded.
   */
  listResourceIds(
    principal: ApiResourceRef,
    relation: string,
    resourceKind: string,
    contextualPolicies: ReadonlyArray<IamPolicySpec>,
  ): Promise<ReadonlyArray<string>>;
  /**
   * The ids of `principalKind` principals holding `relation` on `resource`
   * (ListAuthorizedPrincipalIdsInput's field order). Direct principals
   * only; usersets are not expanded.
   */
  listPrincipalIds(
    resource: ApiResourceRef,
    relation: string,
    principalKind: string,
    contextualPolicies: ReadonlyArray<IamPolicySpec>,
  ): Promise<ReadonlyArray<string>>;
}
