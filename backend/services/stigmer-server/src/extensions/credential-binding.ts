/**
 * The credential-binding seam: the rule that a credential naming an
 * organization works in that organization only, as the composition hands
 * it to the lanes that act on an organization without asking the
 * Authorizer (organization create, API key create, the self-query lanes,
 * and a composition's own such lanes, which receive it through
 * `ComposedServices.credentialBinding`).
 *
 * One implementation, built by the composition root over the rows every
 * posture reads (authorization/credential-binding.ts, which also carries
 * the rule in full); the composed Authorizer, list read scope and
 * organization directory are wrapped with it, so a lane that asks those
 * needs nothing from here. Not a registration point: a binding a unit
 * could replace would be a binding a unit could switch off.
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "./identity.js";
import type { RowAuthorizationFacts } from "./resource-authorization.js";

/** One question to the rule: may this caller's credential reach `permission` on this target? */
export interface BindingTarget {
  readonly kind: ApiResourceKind;
  readonly id: string;
  /** The permission's relation name (the IamPermission enum name, the model's vocabulary). */
  readonly permission: string;
}

/**
 * The rule's answer.
 *   - `unbound`: the caller names no organization; the rule has nothing to say.
 *   - `inside`: the target is the bound organization's, or nobody's.
 *   - `admitted`: outside, along the model's one cross-organization path.
 *   - `missing`: no row has that id; the inner driver answers as it would.
 *   - `outside`: refused.
 */
export type BindingVerdict =
  | "unbound"
  | "inside"
  | "admitted"
  | "missing"
  | "outside";

export interface CredentialBinding {
  /** The rule over one target. Throws on a read fault, never a softened answer. */
  verdict(
    caller: CallerIdentity,
    target: BindingTarget,
  ): Promise<BindingVerdict>;
  /**
   * Whether the caller may act in `org`: always for an unbound caller, only
   * its own for a bound one (a lane that writes into an organization; a
   * parent's management of a child goes through the Authorizer).
   */
  admitsOrganization(caller: CallerIdentity, org: string): boolean;
  /**
   * Whether a list candidate may be shown to the caller, from the facts the
   * candidate carries and, for a blueprint another organization shares with
   * its children, the bound organization's parent (one read per request,
   * memoised). Such a blueprint is kept, for the inner scope to decide, only
   * when that parent shares it. Two answers differ from `verdict` because
   * they would need a row the candidate does not carry: the default instance
   * of the parent's shared workflow is left out of a bound caller's list (a
   * get by id still admits it), and the owner's API keys are all listed
   * (managing one still needs it limited where the caller is).
   */
  keepsEntry(
    caller: CallerIdentity,
    kind: ApiResourceKind,
    entry: RowAuthorizationFacts,
  ): Promise<boolean>;
  /** The subset of `ids` of `kind` the caller's credential may reach `permission` on; reads each id's row, memoised. */
  narrowIds(
    caller: CallerIdentity,
    kind: ApiResourceKind,
    ids: ReadonlySet<string>,
    permission: string,
  ): Promise<ReadonlySet<string>>;
}
