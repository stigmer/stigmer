/**
 * The built-in grant check — the one question of the authorization-query
 * engine (extensions/authorization-queries.ts, `check`) that the built-in
 * posture can answer from its own evaluator: "is this grant effectively
 * held". A unit composed on the built-in posture asks it through the
 * services the composition hands it (extensions/registry.ts,
 * `ComposedServices`), exactly where a composition with its own engine
 * hands that engine's `check`, so the unit asks one question in every
 * edition and the model answers it one way.
 *
 * What it answers, and why no more:
 *   - A grant whose principal is a person (`identity_account:<id>`): the
 *     person the id names, with `personFor`'s alias rule (person.ts), and
 *     the rows they and their teams hold — the same walk a point check
 *     makes for a caller.
 *   - A grant whose principal is any other object (`organization:<o>`):
 *     the structural question a grant to a team asks — does this resource
 *     belong to the team's organization — answered by the resource's own
 *     derived links (derived-tuples.ts).
 *   - Contextual grants are refused as a programming error. No caller
 *     asks with them, and the derived source has no notion of a tuple held
 *     only for the length of one check; answering without them would be a
 *     silent wrong answer, the failure a throw prevents.
 *   - A userset principal (`organization:<o>#member`) is refused the same
 *     way: the engine contract checks direct principals.
 *
 * The engine's list verbs are not answered here: they enumerate, which the
 * built-in posture does not do, and the tuple-half RPCs that expose them
 * keep refusing in open source without an engine. One source per check,
 * like the Authorizer: its memo is the check's. Faults propagate; the
 * caller's own error mapping decides the wire.
 */
import type { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { GrantStore } from "../domain/grant/store.js";
import type { IdentityAccountStore } from "../domain/identityaccount/store.js";
import type { AuthorizationQueryEngine } from "../extensions/authorization-queries.js";
import type { ResourceRowReader } from "../extensions/resource-row-reader.js";
import type { Store } from "../store/interface.js";
import { newDerivedTupleSource } from "./derived-tuples.js";
import { checkRelation } from "./evaluator.js";
import type { Model } from "./model/index.js";
import { builtInModel } from "./model/index.js";
import { personOfAccount } from "./person.js";
import type { Principal } from "./tuples.js";
import { ACCOUNT_TYPE } from "./tuples.js";

export interface BuiltInGrantCheckDeps {
  readonly store: Store;
  /** The port the grant path writes through — the principal's rows are read from the same instance. */
  readonly grants: GrantStore;
  /** The account port: a person principal's aliases, and identity_account objects. */
  readonly accounts: Pick<IdentityAccountStore, "findById">;
  /** The readers of the kinds units keep themselves (`drivers.resourceRowReaders`). */
  readonly rowReaders?: ReadonlyMap<ApiResourceKind, ResourceRowReader>;
  /** The declarations to evaluate; the built-in model unless a test says otherwise. */
  readonly model?: Model;
}

export function newBuiltInGrantCheck(
  deps: BuiltInGrantCheckDeps,
): Pick<AuthorizationQueryEngine, "check"> {
  const model = deps.model ?? builtInModel;
  return {
    async check(grant, contextualGrants) {
      if (contextualGrants.length > 0) {
        throw new Error(
          "the built-in grant check evaluates held grants only — contextual grants are not supported",
        );
      }
      const principalRef = grant.principal;
      const resource = grant.resource;
      if (principalRef === undefined || resource === undefined) {
        throw new Error(
          "the built-in grant check needs a principal and a resource",
        );
      }
      if (principalRef.relation !== "") {
        throw new Error(
          `the built-in grant check takes a direct principal — '${principalRef.kind}:${principalRef.id}#${principalRef.relation}' is a userset`,
        );
      }
      const principal: Principal =
        principalRef.kind === ACCOUNT_TYPE
          ? await personOfAccount(deps.accounts, principalRef.id)
          : { object: { type: principalRef.kind, id: principalRef.id } };
      const source = newDerivedTupleSource(
        {
          store: deps.store,
          grants: deps.grants,
          accounts: deps.accounts,
          rowReaders: deps.rowReaders,
          model,
        },
        principal,
      );
      return checkRelation(
        { model, source },
        { type: resource.kind, id: resource.id },
        grant.relation,
        principal,
      );
    },
  };
}
