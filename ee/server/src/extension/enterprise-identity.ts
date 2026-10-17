/**
 * The enterprise-identity extension unit: federation issuers and
 * federation, invitations and teams, the identity code an organization
 * brings to Stigmer and the code Stigmer Enterprise ships. It fills:
 *
 *   - identityVerifiers: the federated lane (`federated-idp`), store-backed
 *     off the FederationIssuer resource, the single source of federation
 *     trust, and told of every provider write;
 *   - drivers.identityFederation (the four federated IdentityAccount arms
 *     the library dispatches to), drivers.principalDisplay (an access list
 *     names a team by its name) and drivers.resourceRowReaders (where the
 *     library's own authorization reads a provider, an invitation or a
 *     team);
 *   - gateSteps: RemoveOrganizationIdentity on `org-delete:pre-delete` (an
 *     organization's delete removes its teams, providers and invitations
 *     before it answers, or fails; iam/organization-delete.ts); and
 *     OrganizationGrantGate on `grant-create:pre-side-effect-gate` (a
 *     grant stays inside the resource's organization: a team grant is
 *     checked against the team, which exists and is the resource's
 *     organization's, a new member or a person a resource is shared with
 *     is one of its viewers; iam/team/grant-gate.ts);
 *   - services: FederationIssuer, Invitation and Team, kinds open source
 *     does not serve. Their grant and revoke lanes reach the library's grant
 *     path through one client (iam/grant/grant-path-client.ts);
 *   - orgPurge: the `identity` stage, the same three removals again as the
 *     organization's purge (whatever was written between the slot and the
 *     deletion mark), declaring the provider, team and invitation kinds
 *     as its own;
 *   - onComposed and start: the composition's own instances, and the boot
 *     repairs (below).
 *
 * Built over ports, never over adapters. Every input is an interface the
 * code already takes: the four store ports and the schema they read
 * (schema/enterprise-postgres.ts builds all five over a host's pool), the
 * account surface (iam/account/port.ts), the guarded fetch, and the growth
 * gate a licensed host fills (iam/growth-gate.ts). The unit constructs no
 * store and reads no configuration; the host composition builds its
 * adapters and hands them in. The line is held by the
 * host's boundary test, which declares the Enterprise-bound files and the
 * neutral plumbing they may use and refuses any import that crosses it.
 *
 * What the composition itself builds, the unit receives from it rather
 * than from the host (the library's `onComposed`,
 * @stigmer/server's ComposedServices): the one Authorizer the Authorize
 * step of every chain calls, the list read scope, the authorization check,
 * the tuple lifecycle, the in-process transport its grant-path client
 * and organization reads ride, and the grant store binding its repairs
 * and grant gate read. So both halves of one lane (the library's
 * Authorize step and this unit's resolved-target checks) answer by one
 * rule in every host, an OpenFGA authorizer and open source's own
 * authorization alike, and no host can hand it a different instance. The
 * hand-over lands before `composeServer` returns, and nothing calls the
 * unit's lanes before it; a composition with no list scope or no
 * authorization check (one whose callers are not signed in) is refused
 * there, since the unit's lists and gates would then answer nobody's
 * question. Under open source's own authorization there is no lifecycle:
 * a row's organization link is derived from the row, so a creation event
 * has nothing to write. The unit tells that authorization where its rows
 * are: a row reader per kind over its own stores
 * (`drivers.resourceRowReaders`).
 *
 * A create's id is the library's too: its BuildNewState mints
 * `{prefix}_{lowercase ULID}` whatever the request carried, from
 * `@stigmer/server` 3.41.0 on (stigmer/stigmer#1489), and the unit runs no
 * step of its own for it. So a host composes it on that release or later,
 * where an earlier one would keep an id the caller chose; the published
 * suite's minted-id rows (extension/__tests__/enterprise-identity.built-in.test.ts)
 * fail on an earlier one.
 *
 * Its `start` runs first, before anything serves: the Enterprise schema
 * chain (`schema.ensure`), whose failure fails the start, so a server
 * whose tables are not there never listens; then the boot repairs, in
 * order: the missing organization links of providers,
 * invitations and teams, then the direct owner rows the two no-owner kinds
 * that once carried one must not carry (teams never recorded an owner).
 * Each is best-effort and logged row by row, and nothing serves until
 * they have run.
 *
 * Hosted by the host's own IAM unit, not threaded between units by the
 * host's entry: that unit owns the adapters this unit takes, and this is a
 * library over ports that it calls, the way it is consumed when it ships
 * from the public `ee/` package. Its place in the composition is
 * load-bearing, and the host's wiring test pins it: after the host's IAM
 * unit, so the host's own direct-login lane claims ahead of the federated
 * lane and a FederationIssuer row naming the host's own issuer can never
 * capture console tokens, and so that unit's own start runs before this
 * unit's repairs.
 *
 * Child organizations are the library's (an organization names its parent,
 * `spec.parent_org`): this unit only routes a sign-in to one, through the
 * library's child lookup it receives with the composition's instances.
 *
 * Every URL an organization admin writes on a provider (its `jwks_uri`,
 * its `userinfo_endpoint`, its issuers' discovery documents) is dialed
 * through the guarded fetch the host hands in, and through nothing else
 * (extension/__tests__/enterprise-identity.egress.test.ts drives each
 * dial): an admin-written URL is a request-forgery path unless the
 * host's egress policy judges every dial. This unit's JWKS cache is the
 * federated trust level's; the host keeps its own for its own tenant.
 *
 * The host names the issuers its own sign-in lanes claim
 * (`reservedIssuers`): a provider may never name one, on write or at
 * routing, so the verifier order above is a second defence, not the only
 * one. The host also signs its callers in (a host may declare the
 * require-authentication posture; without it, the library itself refuses
 * an edition above open source that signs nobody in) and, if it has a
 * sign-in lane of its own, composes it ahead of this unit.
 *
 * The account surface's `store.findById` answers every account with its
 * provisioning mode, service accounts included, so the lanes that refuse
 * a service account (a provider write, an invitation, a team member) can
 * tell one from a person; a host hands in a store that does.
 *
 * Two invariants every key a federated account takes rests on, which the
 * host keeps and this unit cannot check. First, no lane of the host anchors
 * on a key a federated account can take: the host's per-org system lanes
 * find their accounts by their own subject and label, never by a slug a
 * provider's asserted email derives, and no subject lookup answers a
 * federated row. Second, the host's direct-account provisioning never
 * serves a caller this unit's lane vouched for: the library refuses such a
 * caller before it reads the subject (`@stigmer/server`'s
 * provisionMyAccount admission), because this lane stamps the federated
 * account's id, never the provider's subject.
 */
import type { DescMessage } from "@bufbuild/protobuf";

import { asFetch, type OutboundFetch } from "@stigmer/outbound/egress";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  AuthorizationQueryEngine,
  Authorizer,
  ComposedGrants,
  ComposedServices,
  CredentialBinding,
  GateSlotName,
  ListReadScope,
  Logger,
  PipelineStep,
  ResourceAuthorizationLifecycle,
  ResourceOrganizations,
  ResourceRowReader,
  ServerExtension,
} from "@stigmer/server";

import type { IdentityAccountService } from "../iam/account/port.js";
import type { GrowthGate } from "../iam/growth-gate.js";
import { lateChildOrganizations } from "./late-child-organizations.js";
import { lateNameTable } from "./late-name-table.js";
import type { SignInGrantLedger } from "../iam/federation/sign-in-grants.js";
import {
  newOrganizationIdentityPurgeStage,
  newRemoveOrganizationIdentityStep,
} from "../iam/organization-delete.js";
import { newUserInfoClient } from "../iam/federation/userinfo.js";
import { newStoreBackedFederatedVerifier } from "../iam/federation/verifier.js";
import { newIdentityFederation } from "../iam/identity-federation.js";
import { newInvitationRegistrations } from "../iam/invitation/handlers.js";
import { newInvitationRemoval } from "../iam/invitation/removal.js";
import type { InvitationStore } from "../iam/invitation/store.js";
import {
  newInProcessOrganizationLookup,
  reconcileOrganizationLinks,
} from "../iam/organization-links.js";
import type { OrganizationScopedRow } from "../iam/organization-links.js";
import { reconcileOwnerRows } from "../iam/owner-rows.js";
import type { OwnerRowKind } from "../iam/owner-rows.js";
import { newGrantPathClient } from "../iam/grant/grant-path-client.js";
import { newFederationIssuerRegistrations } from "../iam/issuer/handlers.js";
import { newIssuerRemoval } from "../iam/issuer/removal.js";
import type { FederationIssuerStore } from "../iam/issuer/store.js";
import { newTeamPrincipalDisplay } from "../iam/team/display.js";
import { newOrganizationGrantGateStep } from "../iam/team/grant-gate.js";
import type { TeamPlanGate } from "../iam/team/plan-gate.js";
import { newTeamServiceRegistrations } from "../iam/team/handlers.js";
import { newTeamRemoval } from "../iam/team/removal.js";
import type { TeamStore } from "../iam/team/store.js";
import type { TransportRef } from "../rpc/transport-ref.js";
import type { EnterpriseSchema } from "../schema/enterprise-postgres.js";
import { newJwksKeyCache } from "../verifiers/jwks.js";

/** The unit's name, in boot logs and every registration error. */
export const ENTERPRISE_IDENTITY_UNIT = "enterprise-identity";

/** What the unit is built over: the host's adapters behind their ports. */
export interface EnterpriseIdentityPorts {
  readonly providers: FederationIssuerStore;
  readonly teams: TeamStore;
  readonly invitations: InvitationStore;
  /** The first sign-in of each (account, organization) through a provider (iam/federation/sign-in-grants.ts). */
  readonly signInGrants: SignInGrantLedger;
  /** The stores' tables, made current first in `start` (schema/enterprise-migrations.ts). */
  readonly schema: EnterpriseSchema;
  readonly accounts: IdentityAccountService;
  /** The egress-guarded fetch every tenant-written URL is dialed through. */
  readonly outboundFetch: OutboundFetch;
  /**
   * The issuers this host's own sign-in lanes claim; no federation issuer
   * may name one.
   */
  readonly reservedIssuers: ReadonlyArray<string>;
  readonly logger: Logger;
  /**
   * Whether an organization's plan includes teams (iam/team/plan-gate.ts):
   * a host that bills organizations fills it from its billing; absent (as in
   * self-hosted Enterprise, where teams are an edition feature) every
   * organization may create teams and add members.
   */
  readonly teamPlanGate?: TeamPlanGate;
  /**
   * Whether the server may grow its setup right now (iam/growth-gate.ts):
   * a host whose license can lapse fills it; absent (a host with no
   * license) every team, provider create and provider update is allowed.
   */
  readonly growthGate?: GrowthGate;
}

/** The kinds this domain serves that record no owner, in the order the boot reconciles them. */
const ENTERPRISE_OWNER_ROW_KINDS: ReadonlyArray<OwnerRowKind> = [
  { kind: ApiResourceKind.federation_issuer, key: "federation-issuer", idField: "provider" },
  { kind: ApiResourceKind.invitation, key: "invitation", idField: "invitation" },
];

/** The composition's instances as this unit uses them: every one present. */
interface HandedOver {
  readonly authorizer: Authorizer;
  readonly credentialBinding: Pick<CredentialBinding, "admitsOrganization">;
  readonly listReadScope: ListReadScope;
  readonly authorizationQueries: Pick<AuthorizationQueryEngine, "check">;
  readonly lifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly grants: ComposedGrants;
  readonly resourceOrganizations: ResourceOrganizations;
}

export function newEnterpriseIdentityExtension(
  ports: EnterpriseIdentityPorts,
): ServerExtension {
  const { providers, teams, logger } = ports;

  // The one hole the composition fills, before composeServer returns and
  // before anything can call a lane (onComposed below). The transport the
  // grant-path client and the organization reads ride is filled beside it.
  const transportRef: TransportRef = {};
  let handedOver: HandedOver | undefined;
  function composed(): HandedOver {
    if (handedOver === undefined) {
      throw new Error(
        `the ${ENTERPRISE_IDENTITY_UNIT} unit was called before the composition handed it its services`,
      );
    }
    return handedOver;
  }
  // The composition's instances, reached at call time. Each forwards to the
  // one instance the composition handed over; none adds a rule of its own.
  const authorizer: Authorizer = {
    authorize: (caller, check) => composed().authorizer.authorize(caller, check),
  };
  const listReadScope: ListReadScope = {
    authorizedResourceIds: (caller, kind) =>
      composed().listReadScope.authorizedResourceIds(caller, kind),
    restrictListEntries: (caller, kind, entries) =>
      composed().listReadScope.restrictListEntries(caller, kind, entries),
  };
  const authorizationQueries: Pick<AuthorizationQueryEngine, "check"> = {
    check: (grant, contextual) =>
      composed().authorizationQueries.check(grant, contextual),
  };
  // The sign-in routing and the deprovision's reach read the library's
  // children of an organization.
  const children = lateChildOrganizations(`the ${ENTERPRISE_IDENTITY_UNIT} unit`);
  const childOrganizations = children.lookups;
  // The invitation redeem and the issuer and team renames ask the binding.
  const credentialBinding: Pick<CredentialBinding, "admitsOrganization"> = {
    admitsOrganization: (caller, org) =>
      composed().credentialBinding.admitsOrganization(caller, org),
  };
  // Under open source's own authorization a row's links are derived from
  // the row, so there is no lifecycle and a creation event writes nothing.
  const lifecycle: ResourceAuthorizationLifecycle = {
    onResourceCreated: async (event) => {
      await composed().lifecycle?.onResourceCreated(event);
    },
    onResourceDeleted: async (event) => {
      await composed().lifecycle?.onResourceDeleted(event);
    },
    onVisibilityChanged: async (event) => {
      await composed().lifecycle?.onVisibilityChanged(event);
    },
  };
  // The grant rows, read through the composition's one binding: by
  // resource for the link repair, by kind and relation for the owner-row
  // reconcile, the scope link for the grant gate.
  const grantStore: ComposedGrants = {
    findByResource: (kind, id) => composed().grants.findByResource(kind, id),
    findScopeTuple: (kind, id) => composed().grants.findScopeTuple(kind, id),
    findByResourceKindAndRelation: (kind, relation) =>
      composed().grants.findByResourceKindAndRelation(kind, relation),
  };
  // Which organization a shared resource belongs to, for the grant gate
  // where no scope link is stored (the built-in posture stores none).
  const resourceOrganizations: ResourceOrganizations = {
    organizationOf: (resource) => composed().resourceOrganizations.organizationOf(resource),
  };
  const grants = newGrantPathClient(transportRef);
  // The server's one name table: a team's and a provider's slug is a name
  // there like every named kind's, claimed before the row, released after
  // it, and read by every lookup by slug (@stigmer/server's names steps).
  const nameTable = lateNameTable(`the ${ENTERPRISE_IDENTITY_UNIT} unit`);
  const names = nameTable.names;

  // The federated trust level's JWKS cache: every IdP's `jwks_uri` is an
  // organization admin's word, dialed through the egress-guarded fetch.
  const tenantJwks = newJwksKeyCache({
    fetchImpl: asFetch(ports.outboundFetch),
    logger,
  });
  const userInfo = newUserInfoClient(ports.outboundFetch);

  // One organization read for the invitation lane, the verifier's index,
  // the boot repair and the refusals that name an organization: the lane's
  // redemption check and preview, the orphan rule the index asks, the
  // repair's creation times, and the slug
  // the grant gate's and the provider delete's copy name it by.
  const organizations = newInProcessOrganizationLookup(transportRef);

  // Built before the removals: a provider's removal, from its delete RPC or
  // its organization's delete, invalidates the issuer cache the moment the
  // row is gone, as every provider write does.
  const federatedVerifier = newStoreBackedFederatedVerifier({
    providers,
    accounts: ports.accounts,
    grants,
    childOrganizations,
    signInGrants: ports.signInGrants,
    jwks: tenantJwks,
    fetchUserProfile: userInfo.fetchUserProfile,
    reservedIssuers: ports.reservedIssuers,
    organizations,
    logger,
  });
  const invalidateIssuers = (): void => federatedVerifier.invalidate();
  const providerRemoval = newIssuerRemoval({
    providers,
    names,
    accounts: ports.accounts,
    grants,
    invalidate: invalidateIssuers,
    logger,
  });
  const teamRemoval = newTeamRemoval({ teams, names, grants, logger });
  const invitationRemoval = newInvitationRemoval({
    invitations: ports.invitations,
    grants,
    logger,
  });

  // The boot repair over one kind: best-effort like the host's tuple
  // backfill, and every row it deliberately leaves alone is named for a
  // hand. The provider's lines keep their wording from before invitations
  // joined.
  async function repairOrganizationLinksOf(
    kind: ApiResourceKind,
    noun: { readonly key: string; readonly phrase: string; readonly idField: string },
    rows: () => Promise<ReadonlyArray<OrganizationScopedRow>>,
  ): Promise<void> {
    try {
      const report = await reconcileOrganizationLinks(kind, await rows(), {
        grantStore,
        grants,
        organizations,
      });
      if (report.converged > 0) {
        logger.info(`${noun.key} organization links converged`, {
          count: report.converged,
        });
      }
      for (const orphan of report.orphaned) {
        logger.warn(
          `${noun.phrase} left without its organization link; nobody can manage it until a hand decides`,
          { [noun.idField]: orphan.id, org: orphan.org, reason: orphan.reason },
        );
      }
      for (const failure of report.failures) {
        logger.error(`${noun.key} organization link could not converge`, {
          [noun.idField]: failure.id,
          error: failure.error,
        });
      }
    } catch (error) {
      logger.error(`${noun.key} organization-link reconcile failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Every provider, invitation and team whose organization link is missing
  // gets it back (iam/organization-links.ts), one kind after the other, so a
  // failed read of one kind never skips the next.
  async function repairOrganizationLinks(): Promise<void> {
    await repairOrganizationLinksOf(
      ApiResourceKind.federation_issuer,
      { key: "federation-issuer", phrase: "federation issuer", idField: "provider" },
      () => providers.findAll(),
    );
    // An invitation left unlinked is invisible to its own organization's
    // admins; one whose organization is gone or younger than it is also
    // refused at redemption (iam/invitation/handlers.ts).
    await repairOrganizationLinksOf(
      ApiResourceKind.invitation,
      { key: "invitation", phrase: "invitation", idField: "invitation" },
      () => ports.invitations.findAll(),
    );
    // A team's every permission reads `from organization` (team.fga), so a
    // team whose creation event failed after its row landed is invisible
    // and unmanageable until its link is back (iam/team/handlers.ts).
    await repairOrganizationLinksOf(
      ApiResourceKind.team,
      { key: "team", phrase: "team", idField: "team" },
      () => teams.findAll(),
    );
  }

  // Every direct `owner` row on a provider or an invitation is revoked,
  // read by kind and relation from the grant rows (iam/owner-rows.ts),
  // since both kinds are managed by their organization's current admins
  // alone; a provider's first, and one kind's failed read never skips the
  // next.
  async function revokeOwnerRows(): Promise<void> {
    await reconcileOwnerRows(ENTERPRISE_OWNER_ROW_KINDS, { grantStore, grants, logger });
  }

  const rowReaders = new Map<ApiResourceKind, ResourceRowReader>([
    [ApiResourceKind.federation_issuer, { findById: (id) => providers.findById(id) }],
    [ApiResourceKind.invitation, { findById: (id) => ports.invitations.findById(id) }],
    [ApiResourceKind.team, { findById: (id) => teams.findById(id) }],
  ]);

  return {
    name: ENTERPRISE_IDENTITY_UNIT,
    identityVerifiers: [federatedVerifier],
    drivers: {
      identityFederation: newIdentityFederation({
        accounts: ports.accounts,
        grants,
        providers,
        childOrganizations,
        logger,
      }),
      principalDisplay: newTeamPrincipalDisplay(teams),
      resourceRowReaders: rowReaders,
    },
    gateSteps: new Map<GateSlotName, ReadonlyArray<PipelineStep<DescMessage>>>([
      [
        "org-delete:pre-delete",
        [
          newRemoveOrganizationIdentityStep({
            teams: teamRemoval,
            providers: providerRemoval,
            invitations: invitationRemoval,
          }),
        ],
      ],
      [
        "grant-create:pre-side-effect-gate",
        [
          newOrganizationGrantGateStep({
            teams,
            queries: authorizationQueries,
            scopes: grantStore,
            resources: resourceOrganizations,
            organizations,
            accounts: ports.accounts.store,
            ...(ports.teamPlanGate === undefined ? {} : { plan: ports.teamPlanGate }),
          }),
        ],
      ],
    ]),
    orgPurge: {
      stages: [
        newOrganizationIdentityPurgeStage({
          teams: teamRemoval,
          providers: providerRemoval,
          invitations: invitationRemoval,
          signInGrants: ports.signInGrants,
          logger,
        }),
      ],
    },
    services: [
      ...newFederationIssuerRegistrations({
        authorizer,
        logger,
        store: providers,
        names,
        outboundFetch: ports.outboundFetch,
        reservedIssuers: ports.reservedIssuers,
        removal: providerRemoval,
        lifecycle,
        credentialBinding,
        listReadScope,
        invalidate: invalidateIssuers,
        organizations,
        accounts: ports.accounts.store,
        ...(ports.growthGate === undefined ? {} : { growthGate: ports.growthGate }),
      }),
      ...newInvitationRegistrations({
        authorizer,
        logger,
        store: ports.invitations,
        grants,
        lifecycle,
        listReadScope,
        organizations,
        authorizationQueries,
        credentialBinding,
        accounts: ports.accounts.store,
      }),
      ...newTeamServiceRegistrations({
        authorizer,
        logger,
        teams,
        names,
        removal: teamRemoval,
        lifecycle,
        credentialBinding,
        ...(ports.teamPlanGate === undefined ? {} : { planGate: ports.teamPlanGate }),
        ...(ports.growthGate === undefined ? {} : { growthGate: ports.growthGate }),
      }),
    ],
    onComposed(services: ComposedServices): void {
      if (services.listReadScope === undefined || services.authorizationQueries === undefined) {
        throw new Error(
          `the ${ENTERPRISE_IDENTITY_UNIT} unit needs a composition that signs its callers in: it has no ${
            services.listReadScope === undefined ? "list read scope" : "authorization check"
          } to narrow its lists and check its grants with`,
        );
      }
      handedOver = {
        authorizer: services.authorizer,
        credentialBinding: services.credentialBinding,
        listReadScope: services.listReadScope,
        authorizationQueries: services.authorizationQueries,
        lifecycle: services.resourceAuthorizationLifecycle,
        grants: services.grants,
        resourceOrganizations: services.resourceOrganizations,
      };
      nameTable.fill(services.resourceNames);
      children.fill(services.childOrganizations);
      transportRef.transport = services.inProcessTransport;
    },
    async start(): Promise<void> {
      await ports.schema.ensure();
      await repairOrganizationLinks();
      await revokeOwnerRows();
    },
  };
}
