/**
 * The composed services — what the composition built that a unit's own
 * lanes must use, handed to the unit rather than rebuilt by it. A unit
 * receives them through `ServerExtension.onComposed` (extensions/
 * registry.ts), called once, in unit order, at the end of `composeServer`,
 * before it returns; and it runs boot work that needs them through
 * `ServerExtension.start`, called in unit order first in the server's
 * `start()`, before any worker, reconciler or listener.
 *
 * Why the composition hands these over instead of the host passing them
 * in: under open source's own authorization the Authorizer, the list read
 * scope and the grant check are built inside `composeServer`, after every
 * unit exists, so no host could pass them; and where a host could (its own
 * Authorizer), handing the unit anything but the instance the Authorize
 * step calls would let the unit's gates ask a different question than the
 * chain around them. Receiving the one instance makes that impossible by
 * construction, in every host.
 *
 * The contract:
 *   - `onComposed` is synchronous and only keeps what it is handed. The
 *     unit's lanes may be called by anyone once `composeServer` returns (a
 *     host's own sweep before `start`, a test that never starts), so the
 *     services must be in place by then; nothing in `composeServer` calls
 *     a unit's lanes before the hand-over.
 *   - `start` runs boot work that must finish before anything serves (a
 *     repair of the unit's own rows). A throw fails `start()`, so a server
 *     whose repair failed never listens.
 *   - Every field is the composition's one instance, whichever posture
 *     built it: a unit's registration, or open source's built-in. The
 *     identity accounts are the store binding every lane reads and the
 *     domain's one create path, so an account a unit creates runs the same
 *     chain, gets the same derived id and fires the same tuple lifecycle
 *     as one a person's sign-in creates. The grant store is the same
 *     binding the grant path writes through, handed over for reads. The
 *     Authorizer and the list read scope are handed over bound by the
 *     credential binding (authorization/credential-binding.ts), so a unit
 *     that registered its own Authorizer receives the bound one here and
 *     must hand THIS one, never its own instance, to its consumers.
 */
import type { Transport } from "@connectrpc/connect";
import type { ApiResourceRef } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";

import type { CreateAccount } from "../domain/identityaccount/provisioning.js";
import type { IdentityAccountStore } from "../domain/identityaccount/store.js";
import type { GrantStore } from "../domain/grant/store.js";

import type { AuthorizationQueryEngine } from "./authorization-queries.js";
import type { Authorizer } from "./authorizer.js";
import type { ChildOrganizations } from "./child-organizations.js";
import type { CredentialBinding } from "./credential-binding.js";
import type { ListReadScope } from "./list-read-scope.js";
import type { ResourceAuthorizationLifecycle } from "./resource-authorization.js";
import type { ResourceNameStore } from "../store/interface.js";

/**
 * The identity-account domain as a unit's own lane meets it: the store
 * binding (a unit's registered driver, or open source's adapter) and the
 * one create path, which takes the `federated` provisioning arm an edition
 * that serves federation issuers needs. An update or a delete is an RPC
 * like any other, over the in-process transport below, so it runs the
 * domain's own chain (the person's My vaults and access rows go with the
 * account) and no second path exists.
 */
export interface ComposedIdentityAccounts {
  readonly store: IdentityAccountStore;
  readonly create: CreateAccount;
}

/**
 * The grant store as a unit's own lanes read it: the composition's one
 * binding (a unit's registered driver, or open source's adapter), reads
 * only. A unit's repair finds a resource's rows or every row granting a
 * relation on a kind; its grant gate finds a resource's structural link.
 * A write goes through the domain's grant path (an RPC over the in-process
 * transport), never through this store, so no second write path exists.
 */
export type ComposedGrants = Pick<
  GrantStore,
  "findByResource" | "findScopeTuple" | "findByResourceKindAndRelation"
>;

/**
 * Which organization a resource belongs to, answered as the Grant
 * domain answers it for its change records (domain/grant/grant-path.ts
 * `organizationOf`): through the resource's scope links, else its stored
 * row's `metadata.org`; "" when neither names one. A unit's grant gate
 * asks it where a scope link may be absent: open source's own
 * authorization seeds none, so the policy rows alone cannot say.
 */
export interface ResourceOrganizations {
  organizationOf(resource: ApiResourceRef): Promise<string>;
}

export interface ComposedServices {
  /** The one Authorizer the Authorize step of every chain calls. */
  readonly authorizer: Authorizer;
  /** The one list read scope; undefined where lists are the full scan (open source signed-out). */
  readonly listReadScope: ListReadScope | undefined;
  /**
   * The credential binding (extensions/credential-binding.ts): a bound
   * credential reaches its organization and that organization's children,
   * a run's credential its run's organization alone. For a unit's own lane
   * that acts on an organization without asking the Authorizer (the
   * invitation redeem) and for a unit's rename chains (`RenameChain`). The
   * Authorizer and list read scope above are already bound with it.
   */
  readonly credentialBinding: CredentialBinding;
  /**
   * The child-organization lookups (extensions/child-organizations.ts):
   * for a unit's sign-in routing and billing roll-up, which read a
   * parent's children without asking the Authorizer.
   */
  readonly childOrganizations: ChildOrganizations;
  /**
   * "Is this grant effectively held": the registered engine's `check`, or
   * under open source's own authorization the evaluator's
   * (authorization/grant-check.ts); undefined where neither exists (a
   * unit Authorizer with no engine, or open source signed-out). Unlike the
   * Authorizer above it is NOT bound: it takes no caller, so a unit that
   * asks it on a caller's behalf first asks `credentialBinding.verdict`
   * for the resource, as the server's own self-query lanes do.
   */
  readonly authorizationQueries:
    | Pick<AuthorizationQueryEngine, "check">
    | undefined;
  /**
   * The registered tuple lifecycle; undefined where the tuples are derived
   * from the rows, so a unit's creation event has nothing to write.
   */
  readonly resourceAuthorizationLifecycle:
    | ResourceAuthorizationLifecycle
    | undefined;
  /** The in-process transport: server code calling another domain's RPCs rides it (boot/inprocess.ts). */
  readonly inProcessTransport: Transport;
  /** The identity-account store binding and the domain's one create path. */
  readonly identityAccounts: ComposedIdentityAccounts;
  /** The policy store binding's reads. */
  readonly grants: ComposedGrants;
  /** The organization a resource belongs to, on every posture. */
  readonly resourceOrganizations: ResourceOrganizations;
  /**
   * The store's one name table (pipeline/steps/names.ts): a unit whose
   * named kind keeps its rows in its own table (a team, an identity
   * provider) claims each slug here before its row, through the exported
   * ClaimName with its own NameHolder, releases it after its delete, and
   * reads a slug through it, so one table answers "taken" and resolves
   * names for every kind in every edition. Only the name table: a unit's
   * rows never reach into the store's own.
   */
  readonly resourceNames: ResourceNameStore;
}
