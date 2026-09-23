/**
 * IamPolicy domain constants (20260913.01, T01_0_plan.md §3a;
 * T01_1_review.md Q-OR-6b, Q-OR-9; slice 2 ruling Q-S2-1): the derived
 * policy id and the one spelling of a triple it hashes, the kinds the
 * legacy-creator rule scans, and the byte-pinned wire copy.
 *
 * The derived id (Q-OR-9). A policy's id is a pure function of its triple:
 * `iamp_` + `derivedId` (pipeline/steps/defaults.ts, the encoder shared
 * with the identity account) over the triple's canonical text. The text
 * IS the tuple notation the contract's own comment documents
 * (`principal.kind:principal.id#principal.relation@resource.kind:resource.id#relation`,
 * spec.proto), the principal's `#` present even when its qualifier is
 * empty, so the natural key has one spelling and the primary key is the
 * one home of "one row per triple" in open source: two concurrent grants
 * converge by primary key with no secondary index and no scan. The golden
 * vectors in __tests__/constants.test.ts are wire-adjacent contract: a
 * change here re-addresses every policy open source ever wrote.
 *
 * The text's one weakness (Q-S2-1): `ApiResourceRef` fields carry no
 * character pattern, so an id or relation holding one of the three
 * delimiters could spell another triple's text (`a#b` with an empty
 * qualifier and `a` with qualifier `b#` read alike). `malformedTripleField`
 * names such a field; `policyIdFor` refuses to hash such a spec; the grant
 * path turns the same check into INVALID_ARGUMENT before any read or write.
 * No legitimate reference carries a delimiter: every kind is an enum member
 * name, every id a `prefix_ulid`, a slug or the public wildcard `*`, every
 * relation an FGA relation name — and OpenFGA itself rejects `:` and `#`
 * in ids, so the cloud loses nothing it could ever have written.
 *
 * `BLUEPRINT_KINDS` (Q-OR-6b) is the legacy-creator rule's whole scan: the
 * kinds an admin authors. Sessions, executions, keys and memories are
 * personal and stay with their creator by DD-002 rule 2; they never appear
 * here.
 *
 * The copy moved from the cloud's iam/policy/handlers.ts as-is: the CLI,
 * console and SDK show these sentences verbatim, so they are contract. The
 * new sentences are the two edition refusals (the federation shape), the
 * unknown permission, the unknown principal kind (the resource sentence's
 * shape), the malformed triple, and the four principal refusals a team
 * grantee brought (a person's qualifier, a team's qualifier, a kind no
 * team may be granted, a role a team may not hold).
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  ApiResourceRef,
  IamPolicySpec,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import { derivedId } from "../../pipeline/steps/defaults.js";

/** The kind's id prefix (kind_meta `iam_policy.id_prefix`). */
export const POLICY_ID_PREFIX = "iamp";

/**
 * The proto's `api_version` const (api.proto). The cloud's Java-era rows
 * carry `iam.stigmer.com/v1` and are read as they are (Q-OR-9); every row
 * this domain writes carries the contract's value.
 */
export const IAM_POLICY_API_VERSION = "iam.stigmer.ai/v1";
export const IAM_POLICY_KIND = "IamPolicy";

/** The three characters the canonical text is built from; none may appear inside a field. */
export const TRIPLE_DELIMITERS: ReadonlyArray<string> = [":", "#", "@"];

/** A triple with both references present — the shape the text and the id are defined over. */
interface CompleteTriple {
  readonly principal: ApiResourceRef;
  readonly resource: ApiResourceRef;
  readonly relation: string;
}

function completeTriple(spec: IamPolicySpec): CompleteTriple {
  if (spec.principal === undefined || spec.resource === undefined) {
    throw new Error("policy spec must carry principal and resource");
  }
  return {
    principal: spec.principal,
    resource: spec.resource,
    relation: spec.relation,
  };
}

/**
 * The proto's tuple notation, the one spelling of a triple:
 * `principal.kind:principal.id#principal.relation@resource.kind:resource.id#relation`.
 * The principal's `#` is always present (an empty qualifier reads `#@`),
 * so the same triple never has two texts.
 */
export function canonicalTripleText(spec: IamPolicySpec): string {
  const { principal, resource, relation } = completeTriple(spec);
  return `${principal.kind}:${principal.id}#${principal.relation}@${resource.kind}:${resource.id}#${relation}`;
}

/**
 * The first field, in the text's order, holding a delimiter — or
 * `undefined` for a well-formed triple. Named in the proto's field paths so
 * a refusal tells the caller exactly what to fix. Total over a spec
 * missing a reference: that is `completeTriple`'s refusal, not this one.
 */
export function malformedTripleField(spec: IamPolicySpec): string | undefined {
  const fields: ReadonlyArray<readonly [path: string, value: string]> = [
    ["principal.kind", spec.principal?.kind ?? ""],
    ["principal.id", spec.principal?.id ?? ""],
    ["principal.relation", spec.principal?.relation ?? ""],
    ["resource.kind", spec.resource?.kind ?? ""],
    ["resource.id", spec.resource?.id ?? ""],
    ["relation", spec.relation],
  ];
  for (const [path, value] of fields) {
    if (TRIPLE_DELIMITERS.some((delimiter) => value.includes(delimiter))) {
      return path;
    }
  }
  return undefined;
}

/**
 * The derived policy id of a triple. Pure; refuses a spec missing either
 * reference (a triple is the whole key) and a spec whose text would be
 * ambiguous (Q-S2-1) — both are the assert behind the grant path's gate,
 * which is where a caller hears INVALID_ARGUMENT.
 */
export function policyIdFor(spec: IamPolicySpec): string {
  const text = canonicalTripleText(spec);
  const malformed = malformedTripleField(spec);
  if (malformed !== undefined) {
    throw new Error(malformedTripleMessage(malformed));
  }
  return derivedId(POLICY_ID_PREFIX, text);
}

/**
 * The kinds an admin authors — the legacy-creator rule's scan (Q-OR-6b),
 * in registry order. A caller who created one of these idp-shaped, before
 * an account existed, becomes admin on first sign-in.
 */
export const BLUEPRINT_KINDS: ReadonlyArray<ApiResourceKind> = [
  ApiResourceKind.agent,
  ApiResourceKind.workflow,
  ApiResourceKind.skill,
  ApiResourceKind.mcp_server,
  ApiResourceKind.environment,
  ApiResourceKind.schedule,
];

/**
 * The bootstrap-state key the membership rules' one-shot reconciliation
 * writes when it has run (membership.ts `ensureRolesForExistingAccounts`):
 * a database whose accounts were provisioned before the rules existed is
 * reconciled once, at the first boot under the built-in authorization
 * posture, and never again — the value is the RFC 3339 time it finished.
 * Lives in `store.bootstrapState`, the store's one-shot boot state, and is
 * the one key this server writes there; deleting it makes the next boot
 * reconcile again, which is the operator's deliberate act and nobody else's.
 */
export const ROLES_RECONCILED_KEY = "membership_rules_reconciled";

/**
 * The principal kinds a PERSON may grant a role to — the user `create`
 * lane's grantee vocabulary (2026-09-14, session 9 ruling Q-S9-2; the
 * security read's finding 41): a person (the identity account) and a team
 * of people. A row whose principal is a RESOURCE
 * (`organization:A#organization@platform_client:X`, `#managed_org`) is a
 * structural link, and structural links are `bootstrapPolicy`'s — the
 * platform's own lane, which skips role validation by design.
 *
 * Why the rule is load-bearing: the read side treats every principal
 * outside this vocabulary as a structural parent (`findScopeTuple`,
 * resource-store.ts, which derives its exclusion FROM this constant so the
 * two cannot drift), and the hierarchy walk follows it. Without the arm, a
 * person with `can_grant_access` on organization B could write
 * `organization:A#member@organization:B` and B's Members page, asked for
 * inherited access, would list A's people.
 *
 * Each kind grants through its own list: a person the kind's
 * `grantable_roles`, a team its `team_grantable_roles`, always as the
 * team's members (`TEAM_MEMBERS_RELATION`). A kind that lists no team role
 * — `organization` among them, so open source's organization-only scope —
 * grants a team nothing.
 */
export const USER_GRANT_PRINCIPAL_KINDS: ReadonlyArray<ApiResourceKind> = [
  ApiResourceKind.identity_account,
  ApiResourceKind.team,
];

/**
 * The one relation a team principal names: the team's members. A grant to
 * `team:<id>#member` is a grant to every member, and membership is bounded
 * by organization membership in the model, so leaving the organization
 * ends the grant with no cleanup.
 */
export const TEAM_MEMBERS_RELATION = "member";

// ---------------------------------------------------------------------------
// Byte-pinned copy (the cloud handlers' sentences, moved as-is).
// ---------------------------------------------------------------------------

/** get on a missing policy (NOT_FOUND). */
export function policyNotFoundMessage(id: string): string {
  return `IAM policy not found: ${id}`;
}

/** A grant on a kind whose kind_meta lists no grantable roles (INVALID_ARGUMENT, every edition). */
export function noGrantableRolesMessage(kind: string): string {
  return `No roles can be granted on resource kind '${kind}'. Role assignments for this resource kind are system-managed.`;
}

/** A role the kind does not list (INVALID_ARGUMENT); the grantable list in kind_meta order. */
export function roleNotGrantableMessage(
  role: string,
  kind: string,
  grantable: ReadonlyArray<string>,
): string {
  return `Role '${role}' cannot be granted on resource kind '${kind}'. Grantable roles: [${grantable.join(", ")}]`;
}

/** checkMyPermission for a caller with no identity (UNAUTHENTICATED). */
export const AUTHENTICATION_REQUIRED_MESSAGE =
  "Authentication required to check permissions";

/**
 * A spec whose resource kind is not an ApiResourceKind member name
 * (INVALID_ARGUMENT; the cloud's `kindFromSpecString` sentence). The grant
 * path is where a permissive Authorizer's caller hears it; an enforcing
 * Authorizer denies the unknown kind at position 1 first (slice 1, ruling 2).
 */
export function unknownResourceKindMessage(kind: string): string {
  return `Unknown resource kind: '${kind}'`;
}

// ---------------------------------------------------------------------------
// New copy (this entry's refusals).
// ---------------------------------------------------------------------------

/**
 * A grant on a kind outside the composed grant scope (UNIMPLEMENTED) — the
 * federation and kind-registry degrade-by-probe posture: the sentence a
 * person can act on, naming the editions that serve it.
 */
export const PER_RESOURCE_GRANTS_UNIMPLEMENTED_MESSAGE =
  "per-resource access grants are served by the Enterprise and Cloud editions";

/** The tuple-half queries on a composition without an AuthorizationQueryEngine (UNIMPLEMENTED). */
export const AUTHORIZATION_QUERIES_UNIMPLEMENTED_MESSAGE =
  "authorization queries are served by the Enterprise and Cloud editions";

/** checkMyPermission with a relation that is no IamPermission name (INVALID_ARGUMENT). */
export function unknownPermissionMessage(relation: string): string {
  return `unknown permission '${relation}'`;
}

/** A spec whose principal kind is not an ApiResourceKind member name (INVALID_ARGUMENT). */
export function unknownPrincipalKindMessage(kind: string): string {
  return `Unknown principal kind: '${kind}'`;
}

/**
 * A user grant whose principal is not a person (INVALID_ARGUMENT; Q-S9-2),
 * in the role sentence's shape: the offending kind, then the vocabulary.
 */
export function principalNotGrantableMessage(kind: string): string {
  const grantable = USER_GRANT_PRINCIPAL_KINDS.map((k) => kindEnumName(k));
  return `Principal kind '${kind}' cannot be granted a role. Grantable principal kinds: [${grantable.join(", ")}]`;
}

/**
 * A person principal carrying a relation qualifier (INVALID_ARGUMENT). A
 * person is granted a role directly; `identity_account:<id>#<relation>`
 * names no one, and OpenFGA would refuse the tuple after the row was
 * written.
 */
export function personQualifierMessage(relation: string): string {
  return `Principal kind 'identity_account' takes no relation; got '${relation}'`;
}

/** A team principal naming a relation other than its members (INVALID_ARGUMENT). */
export function teamQualifierMessage(relation: string): string {
  return `A team principal must name the relation '${TEAM_MEMBERS_RELATION}' (the team's members); got '${relation}'`;
}

/** A team grant on a kind that lists no team role (INVALID_ARGUMENT). */
export function teamNotGrantableMessage(kind: string): string {
  return `A team cannot be granted access to resource kind '${kind}'.`;
}

/** A team grant of a role the kind does not let a team hold (INVALID_ARGUMENT); the list in kind_meta order. */
export function teamRoleNotGrantableMessage(
  role: string,
  kind: string,
  grantable: ReadonlyArray<string>,
): string {
  return `Role '${role}' cannot be granted to a team on resource kind '${kind}'. Roles a team can hold: [${grantable.join(", ")}]`;
}

/** A triple field holding a canonical-text delimiter (INVALID_ARGUMENT; Q-S2-1). */
export function malformedTripleMessage(field: string): string {
  return `policy ${field} must not contain ':', '#' or '@'`;
}
