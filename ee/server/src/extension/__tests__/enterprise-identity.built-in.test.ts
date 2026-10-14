/**
 * The Enterprise identity unit on open source's own authorization: the
 * unit composed onto `@stigmer/server` at edition `enterprise` with no
 * Authorizer of its own, so the library's built-in Authorizer, list read
 * scope and policy check answer every one of its questions from the one
 * authorization model, over the rows the unit keeps in its own stores
 * (read through the row readers it registers). The host is the least an
 * Enterprise host can be: a unit that declares the edition and the
 * require-authentication posture, signs its callers in with one verifier,
 * and registers one IamPolicy store the library's grant path writes and
 * the unit's repairs read; its people hold accounts in the library's own
 * store, as people who have signed in before do. Everything else is the
 * library's.
 *
 * It asserts the authorization cases a host's OpenFGA suites assert for the
 * same unit, so one unit is held to one answer on both engines:
 *
 *   - identity providers: an org admin creates one, with its organization
 *     link and no owner row; its organization's admins read it by id, by
 *     name and in the list, and its members, viewers and outsiders do not;
 *     an admin who did not create it edits it, a member does not; its
 *     creator demoted below admin cannot edit it, and restored can; every
 *     read refuses an unauthenticated caller; an organization's delete
 *     removes its providers;
 *   - invitations: its organization's admins read and list it, token
 *     included; a viewer can do neither, and cannot revoke one; a valid
 *     single-use link redeems once for a person outside the organization;
 *     an organization's delete removes its invitations;
 *   - teams: every organization viewer sees a team; a viewer is added and
 *     an outsider refused before anything is written; a private agent
 *     shared with the team reaches its member and not an outsider, and its
 *     access list names the team; a team of another organization cannot be
 *     granted on the agent; leaving the organization removes access through
 *     the team at once, and rejoining restores it; deleting the team
 *     removes every row naming it; an organization's delete removes its
 *     teams.
 *
 * Beside those cases, and outside the parity with the OpenFGA suites, the
 * unit's four creates of a kind open source does not serve (team,
 * invitation, identity provider, and the identity provider's apply as a
 * create) each replace a well-formed id the caller sent with one the server
 * minted, and the resource reads back under the minted id
 * (stigmer/stigmer#1489, the rule the OSS conformance suite holds for the
 * open-source kinds). Each row founds an organization of its own, so the
 * cases above never see its rows. The rows are complete by rule, not by
 * list: a case walks the methods of the services the unit registers and
 * refuses a create, or an apply, whose request carries metadata and has no
 * row, so a create a later contract adds to an Enterprise kind fails here
 * until its row exists. A host that serves these kinds keeps its own
 * inventory of the whole contract and names this suite as their home.
 *
 * The in-memory IamPolicy store is first held to the library's own
 * port-contract kit, so the answers below rest on a store the contract
 * vouches for.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { DescService } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient, createConnectRouter } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { guardedFetch } from "@stigmer/outbound/egress";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import { IamPolicyQueryController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/query_pb";
import {
  ApiResourceRefSchema,
  type IamPolicySpec,
  IamPolicySpecSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityProviderCommandController } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/command_pb";
import { IdentityProviderQueryController } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/query_pb";
import { InvitationCommandController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/command_pb";
import { InvitationState } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/enum_pb";
import { InvitationQueryController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/query_pb";
import { TeamCommandController } from "@stigmer/protos/ai/stigmer/iam/team/v1/command_pb";
import { TeamQueryController } from "@stigmer/protos/ai/stigmer/iam/team/v1/query_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import {
  composeServer,
  createLogger,
  iamPolicyStoreContract,
  loadConfig,
  platformTokenKeyRingFromPem,
  strictEgressPolicy,
} from "@stigmer/server";
import type { ComposedServer, IdentityVerifier, ServerExtension } from "@stigmer/server";

import { InMemoryIamPolicyStore } from "../../__test-utils__/in-memory-iam-policy-store.js";
import { foreignId, kindMetaOf, mintedIdPattern } from "../../__test-utils__/minted-id.js";
import { refusingPort } from "../../__test-utils__/refusing-doubles.js";
import type { IdentityAccountService } from "../../iam/account/port.js";
import { InMemoryInvitationStore } from "../../iam/invitation/__tests__/in-memory-invitation-store.js";
import { newKindMetaPolicyGrantScope } from "../../iam/policy/roles.js";
import { InMemoryProviderStore } from "../../iam/provider/__tests__/in-memory-provider-store.js";
import {
  publicLookup,
  publishedIssuer,
  publishedIssuersFetch,
} from "../../iam/provider/__tests__/published-issuers.js";
import { InMemoryTeamStore } from "../../iam/team/__tests__/in-memory-team-store.js";
import { inMemorySignInGrants } from "../../iam/federation/__tests__/in-memory-sign-in-grants.js";
import { newEnterpriseIdentityExtension } from "../enterprise-identity.js";

const ACME = "acme";
const GLOBEX = "globex";
const FOUNDER = "ida_ee_founder"; // owner of acme
const CAROL = "ida_ee_carol"; // admin of acme, a provider's creator
const ANA = "ida_ee_ana"; // admin of acme
const DAVE = "ida_ee_dave"; // member of acme
const VERA = "ida_ee_vera"; // viewer of acme
const VIC = "ida_ee_vic"; // viewer of acme, the team's member
const NEWCOMER = "ida_ee_newcomer"; // nobody in acme until an invitation
const HOLDER = "ida_ee_holder"; // nobody in acme
const OUTSIDER = "ida_ee_outsider"; // owner of globex

const DAY_MS = 24 * 60 * 60 * 1000;
const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

/** The host's one sign-in lane: a bearer `ee:<account>` is that account, a person. */
const TOKEN_PREFIX = "ee:";
const fixtureVerifier: IdentityVerifier = {
  name: "enterprise-fixture-verifier",
  verify: (token) =>
    Promise.resolve(
      token.startsWith(TOKEN_PREFIX)
        ? {
            identityId: token.slice(TOKEN_PREFIX.length),
            callerClass: "user",
            issuer: "enterprise-fixture",
            rawToken: token,
          }
        : null,
    ),
};

const ringKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const RING = platformTokenKeyRingFromPem({
  privateKeyPem: ringKeys.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  publicKeyPems: [ringKeys.publicKey.export({ format: "pem", type: "spki" }).toString()],
});

/**
 * No federated account or service account exists here: a provider's
 * removal lists none to delete, a team's member add finds no service
 * account by id, and every other use of the account service refuses.
 */
const noFederatedAccounts: IdentityAccountService = new Proxy(refusingPort<IdentityAccountService>("accounts"), {
  get: (target, member) =>
    member === "store"
      ? new Proxy(refusingPort<IdentityAccountService["store"]>("accounts.store"), {
          get: (store, storeMember) =>
            storeMember === "findByProvider"
              ? () => Promise.resolve([])
              : storeMember === "findById"
                ? () => Promise.resolve(undefined)
                : Reflect.get(store, storeMember),
        })
      : Reflect.get(target, member),
});

function ref(kind: string, id: string, relation = "") {
  return create(ApiResourceRefSchema, { kind, id, relation });
}

function grant(
  principal: ReturnType<typeof ref>,
  relation: string,
  resource: ReturnType<typeof ref>,
): IamPolicySpec {
  return create(IamPolicySpecSchema, { principal, relation, resource });
}

describe("the in-memory IamPolicy store this suite composes", () => {
  for (const contractCase of iamPolicyStoreContract(async () => {
    const store = new InMemoryIamPolicyStore();
    return {
      store,
      disconnect: () => {
        store.disconnect();
        return Promise.resolve();
      },
      cleanup: () => Promise.resolve(),
    };
  }, { keepsHistory: true })) {
    it(contractCase.name, contractCase.run);
  }
});

describe("the Enterprise identity unit on open source's own authorization (composed, in memory)", () => {
  let server: ComposedServer;
  let port: number;
  let dir: string;
  // The services the unit registers, read from its registrations.
  let served: ReadonlyArray<DescService> = [];
  const policyStore = new InMemoryIamPolicyStore();
  const providers = new InMemoryProviderStore();
  const invitations = new InMemoryInvitationStore();
  const teams = new InMemoryTeamStore();

  function transport(token?: string): Transport {
    return createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
      interceptors:
        token === undefined
          ? []
          : [
              (next) => (request) => {
                request.header.set("authorization", `Bearer ${token}`);
                return next(request);
              },
            ],
    });
  }

  function as(account: string): Transport {
    return transport(`${TOKEN_PREFIX}${account}`);
  }

  async function refusalOf(work: Promise<unknown>): Promise<ConnectError> {
    const error = await work.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConnectError);
    return ConnectError.from(error);
  }

  function rowsNaming(kind: string, id: string): number {
    return policyStore
      .all()
      .filter(
        (row) =>
          (row.spec?.principal?.kind === kind && row.spec?.principal?.id === id) ||
          (row.spec?.resource?.kind === kind && row.spec?.resource?.id === id),
      ).length;
  }

  async function createOrganization(slug: string, founder: string): Promise<void> {
    await createClient(OrganizationCommandController, as(founder)).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: slug, slug, org: "" },
      spec: { description: "the Enterprise identity unit on the built-in authorization" },
    });
  }

  async function createProvider(
    name: string,
    org: string,
    admin: string,
  ): Promise<string> {
    const issuer = `https://${name.toLowerCase().replaceAll(" ", "-")}.${org}.test`;
    const provider = await createClient(IdentityProviderCommandController, as(admin)).create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "IdentityProvider",
      metadata: { name, org },
      spec: {
        displayName: name,
        ...publishedIssuer(issuer),
        expectedAudience: `${issuer}/stigmer`,
      },
    });
    return provider.metadata?.id ?? "";
  }

  function editProvider(as_: string, id: string, displayName: string) {
    return createClient(IdentityProviderCommandController, as(as_)).update({ resource: {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "IdentityProvider",
      metadata: { id, name: "Acme Platform", org: ACME },
      spec: {
        displayName,
        ...publishedIssuer("https://acme-platform.acme.test"),
        expectedAudience: "https://acme-platform.acme.test/stigmer",
      },
    }, updateMask: { paths: ["*"] } });
  }

  async function listedProviders(account: string): Promise<string[]> {
    const answer = await createClient(IdentityProviderQueryController, as(account)).listByOrg({ org: ACME });
    return answer.entries.map((entry) => entry.metadata?.id ?? "");
  }

  async function createInvitation(
    org: string,
    creator: string,
    role: IamRole,
    maxRedemptions: number,
  ): Promise<{ id: string; token: string }> {
    const invitation = await createClient(InvitationCommandController, as(creator)).create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "Invitation",
      metadata: { name: `invite-${IamRole[role]}-${maxRedemptions}`, org },
      spec: {
        role,
        maxRedemptions,
        expiresAt: timestampFromDate(new Date(Date.now() + 7 * DAY_MS)),
        label: `the ${IamRole[role]} link`,
      },
    });
    return { id: invitation.metadata?.id ?? "", token: invitation.status?.token ?? "" };
  }

  async function createTeam(name: string, org: string, admin: string): Promise<string> {
    const team = await createClient(TeamCommandController, as(admin)).create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "Team",
      metadata: { name, org },
      spec: { description: `the ${name} team` },
    });
    return team.metadata?.id ?? "";
  }

  async function canViewAgent(account: string, agentId: string): Promise<boolean> {
    try {
      await createClient(AgentQueryController, as(account)).get({ value: agentId });
      return true;
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.PermissionDenied) {
        return false;
      }
      throw error;
    }
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "enterprise-identity-built-in-"));
    const host: ServerExtension = {
      name: "enterprise-host",
      edition: ServerEdition.enterprise,
      requireAuthentication: true,
      identityVerifiers: [fixtureVerifier],
      drivers: {
        platformTokenKeys: RING,
        iamPolicyStore: policyStore,
        policyGrantScope: newKindMetaPolicyGrantScope(),
      },
    };
    const unit = newEnterpriseIdentityExtension({
      providers,
      teams,
      invitations,
      signInGrants: inMemorySignInGrants(),
      accounts: noFederatedAccounts,
      schema: { ensure: () => Promise.resolve() },
      outboundFetch: guardedFetch(strictEgressPolicy(), {
        fetchImpl: publishedIssuersFetch,
        lookup: publicLookup,
      }),
      reservedIssuers: [],
      logger: silentLogger,
    });
    const router = createConnectRouter();
    for (const register of unit.services ?? []) {
      register(router);
    }
    served = [...new Set(router.handlers.map((handler) => handler.service))];
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: silentLogger,
      extensions: [host, unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    // Every person here has signed in before: open source records an
    // organization's owner, and evaluates a caller, by the caller's
    // provisioned account, whose id the fixture verifier stamps.
    for (const person of [FOUNDER, CAROL, ANA, DAVE, VERA, VIC, NEWCOMER, HOLDER, OUTSIDER]) {
      await server.store.saveResource(
        ApiResourceKind.identity_account,
        person,
        IdentityAccountSchema,
        create(IdentityAccountSchema, {
          apiVersion: "iam.stigmer.ai/v1",
          kind: "IdentityAccount",
          metadata: { id: person, name: person },
          spec: {
            idpId: person,
            email: `${person}@example.test`,
            provisioningMode: IdentityAccountProvisioningMode.direct,
          },
        }),
      );
    }
    port = await server.start();

    await createOrganization(ACME, FOUNDER);
    await createOrganization(GLOBEX, OUTSIDER);
    const acme = createClient(IamPolicyCommandController, as(FOUNDER));
    for (const [who, role] of [
      [CAROL, "admin"],
      [ANA, "admin"],
      [DAVE, "member"],
      [VERA, "viewer"],
      [VIC, "viewer"],
    ] as const) {
      await acme.create(grant(ref("identity_account", who), role, ref("organization", ACME)));
    }
  }, 120_000);

  afterAll(async () => {
    await server?.shutdown();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("identity providers", () => {
    let providerId = "";

    it("an org admin creates a provider: the row lands with its organization link and no owner row", async () => {
      providerId = await createProvider("Acme Platform", ACME, CAROL);
      expect(providerId).toMatch(/^idp_[0-9a-z]{26}$/);
      expect(await providers.findById(providerId)).toBeDefined();
      expect(
        policyStore
          .all()
          .filter((row) => row.spec?.resource?.kind === "identity_provider" && row.spec?.resource?.id === providerId)
          .filter((row) => row.spec?.relation === "owner"),
      ).toEqual([]);
    });

    it("its organization's admins read it by id, by name and in the list; members, viewers and outsiders do not", async () => {
      for (const admin of [CAROL, ANA, FOUNDER]) {
        const queries = createClient(IdentityProviderQueryController, as(admin));
        expect((await queries.get({ value: providerId })).metadata?.id).toBe(providerId);
        expect((await queries.getByReference({ org: ACME, slug: "acme-platform" })).metadata?.id).toBe(providerId);
        expect(await listedProviders(admin)).toEqual([providerId]);
      }
      for (const person of [DAVE, VERA]) {
        const queries = createClient(IdentityProviderQueryController, as(person));
        expect((await refusalOf(queries.get({ value: providerId }))).code).toBe(Code.PermissionDenied);
        expect(
          (await refusalOf(queries.getByReference({ org: ACME, slug: "acme-platform" }))).code,
        ).toBe(Code.PermissionDenied);
        expect(await listedProviders(person)).toEqual([]);
      }
      const outsider = createClient(IdentityProviderQueryController, as(OUTSIDER));
      expect((await refusalOf(outsider.get({ value: providerId }))).code).toBe(Code.PermissionDenied);
      expect(
        (await refusalOf(outsider.getByReference({ org: ACME, slug: "acme-platform" }))).code,
      ).toBe(Code.PermissionDenied);
      expect((await refusalOf(outsider.listByOrg({ org: ACME }))).code).toBe(Code.PermissionDenied);
    });

    it("an admin who did not create it edits it; a member does not", async () => {
      expect((await editProvider(ANA, providerId, "Acme Platform (edited by Ana)")).spec?.displayName).toBe(
        "Acme Platform (edited by Ana)",
      );
      expect((await refusalOf(editProvider(DAVE, providerId, "edited by a member"))).code).toBe(
        Code.PermissionDenied,
      );
    });

    it("its creator, demoted below admin, can no longer edit it; restored, can again", async () => {
      const owner = createClient(IamPolicyCommandController, as(FOUNDER));
      await owner.create(grant(ref("identity_account", CAROL), "member", ref("organization", ACME)));
      await owner.delete(grant(ref("identity_account", CAROL), "admin", ref("organization", ACME)));
      expect((await refusalOf(editProvider(CAROL, providerId, "edited by its creator"))).code).toBe(
        Code.PermissionDenied,
      );

      await owner.create(grant(ref("identity_account", CAROL), "admin", ref("organization", ACME)));
      await owner.delete(grant(ref("identity_account", CAROL), "member", ref("organization", ACME)));
      expect((await editProvider(CAROL, providerId, "edited by its creator")).spec?.displayName).toBe(
        "edited by its creator",
      );
    });

    it("every provider read refuses an unauthenticated caller", async () => {
      await createProvider("Acme Partner", ACME, CAROL);
      const tokenless = createClient(IdentityProviderQueryController, transport());

      expect((await refusalOf(tokenless.getByReference({ org: ACME, slug: "acme-partner" }))).code).toBe(
        Code.Unauthenticated,
      );
      expect((await refusalOf(tokenless.listByOrg({ org: ACME }))).code).toBe(Code.Unauthenticated);
      expect((await refusalOf(tokenless.get({ value: providerId }))).code).toBe(Code.Unauthenticated);
    });

    it("deleting an organization removes its providers and every row naming them", async () => {
      await createOrganization("phoenix", FOUNDER);
      const doomed = await createProvider("Doomed", "phoenix", FOUNDER);
      await createClient(OrganizationCommandController, as(FOUNDER)).delete({ value: "phoenix" });
      expect(await providers.findById(doomed)).toBeUndefined();
      expect(rowsNaming("identity_provider", doomed)).toBe(0);
    });
  });

  describe("invitations", () => {
    let ownerLink = { id: "", token: "" };

    beforeAll(async () => {
      ownerLink = await createInvitation(ACME, FOUNDER, IamRole.owner, 0);
    });

    it("the organization's admins read and list its invitations, token included", async () => {
      expect(ownerLink.id).toMatch(/^inv_[0-9a-z]{26}$/);
      expect(ownerLink.token).not.toBe("");
      const byId = await createClient(InvitationQueryController, as(ANA)).get({ value: ownerLink.id });
      expect(byId.status?.token).toBe(ownerLink.token);
      const listed = await createClient(InvitationQueryController, as(ANA)).listByOrg({ org: ACME });
      expect(listed.entries.map((entry) => entry.status?.token)).toContain(ownerLink.token);
    });

    it("a viewer cannot read an invitation by id, and a viewer's list carries none, so no token", async () => {
      const viewer = createClient(InvitationQueryController, as(VERA));
      expect((await refusalOf(viewer.get({ value: ownerLink.id }))).code).toBe(Code.PermissionDenied);
      expect((await viewer.listByOrg({ org: ACME })).entries).toEqual([]);
    });

    it("a viewer cannot revoke an invitation; an admin can", async () => {
      const link = await createInvitation(ACME, FOUNDER, IamRole.viewer, 0);
      const refused = await refusalOf(
        createClient(InvitationCommandController, as(VERA)).revoke({ value: link.id }),
      );
      expect(refused.code).toBe(Code.PermissionDenied);
      const revoked = await createClient(InvitationCommandController, as(ANA)).revoke({ value: link.id });
      expect(revoked.status?.state).toBe(InvitationState.revoked);
    });

    it("a valid single-use link redeems once for a person outside the organization", async () => {
      const link = await createInvitation(ACME, ANA, IamRole.member, 1);
      const redeemed = await createClient(InvitationCommandController, as(NEWCOMER)).redeem({
        token: link.token,
      });
      expect(redeemed.status?.redemptionCount).toBe(1);
      expect(redeemed.status?.state).toBe(InvitationState.fully_redeemed);
      const again = await refusalOf(
        createClient(InvitationCommandController, as(HOLDER)).redeem({ token: link.token }),
      );
      expect(again.code).toBe(Code.FailedPrecondition);
      expect(again.rawMessage).toBe("This invitation has reached its maximum number of uses");
    });

    it("deleting an organization removes its invitations", async () => {
      await createOrganization("initech", FOUNDER);
      await createInvitation("initech", FOUNDER, IamRole.owner, 0);
      await createClient(OrganizationCommandController, as(FOUNDER)).delete({ value: "initech" });
      expect(await invitations.findIdsByOrg("initech")).toEqual([]);
    });
  });

  describe("teams", () => {
    let teamId = "";
    let agentId = "";

    beforeAll(async () => {
      const agent = await createClient(AgentCommandController, as(ANA)).create({
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: { name: "triage", org: ACME, visibility: ApiResourceVisibility.visibility_private },
        spec: {
          description: "the Enterprise team proof",
          instructions: "You answer the Enterprise team proof and nothing else.",
        },
      });
      agentId = agent.metadata?.id ?? "";
    });

    it("an org admin creates a team and every organization viewer sees it; an outsider does not", async () => {
      teamId = await createTeam("Site Reliability", ACME, ANA);
      expect(teamId).toMatch(/^tm_[0-9a-z]{26}$/);
      expect((await createClient(TeamQueryController, as(VIC)).get({ value: teamId })).metadata?.name).toBe(
        "Site Reliability",
      );
      expect(
        (await refusalOf(createClient(TeamQueryController, as(OUTSIDER)).get({ value: teamId }))).code,
      ).toBe(Code.PermissionDenied);
    });

    it("adds one of the organization's viewers and refuses an outsider before anything is written", async () => {
      const policies = createClient(IamPolicyCommandController, as(ANA));
      await policies.create(grant(ref("identity_account", VIC), "member", ref("team", teamId)));
      const refused = await refusalOf(
        policies.create(grant(ref("identity_account", OUTSIDER), "member", ref("team", teamId))),
      );
      expect(refused.code).toBe(Code.FailedPrecondition);
      expect(refused.rawMessage).toBe(
        `identity account '${OUTSIDER}' is not a member of organization '${ACME}'; add them to the organization before adding them to one of its teams`,
      );
      expect(
        policyStore
          .all()
          .filter((row) => row.spec?.principal?.id === OUTSIDER && row.spec?.resource?.id === teamId),
      ).toEqual([]);
    });

    it("a private agent shared with the team reaches the member, not the outsider, and its access list names the team", async () => {
      expect(await canViewAgent(VIC, agentId)).toBe(false);
      await createClient(IamPolicyCommandController, as(ANA)).create(
        grant(ref("team", teamId, "member"), "viewer", ref("agent", agentId)),
      );
      expect(await canViewAgent(VIC, agentId)).toBe(true);
      expect(
        (await refusalOf(createClient(AgentQueryController, as(OUTSIDER)).get({ value: agentId }))).code,
      ).toBe(Code.PermissionDenied);

      const access = await createClient(IamPolicyQueryController, as(ANA)).listResourceAccessByPrincipal({
        resource: ref("agent", agentId),
        includeInherited: false,
      });
      const teamEntry = access.entries.find((entry) => entry.principal?.kind === "team");
      expect(teamEntry?.principal?.id).toBe(teamId);
      expect(teamEntry?.principal?.relation).toBe("member");
      expect(teamEntry?.principal?.name).toBe("Site Reliability");
    });

    it("refuses a team of another organization on the agent", async () => {
      const otherTeam = await createTeam("Partners", GLOBEX, OUTSIDER);
      const refused = await refusalOf(
        createClient(IamPolicyCommandController, as(ANA)).create(
          grant(ref("team", otherTeam, "member"), "viewer", ref("agent", agentId)),
        ),
      );
      expect(refused.code).toBe(Code.FailedPrecondition);
      // The caller administers the agent, not the team: the copy names only
      // the id sent, never the team's name or organization.
      expect(refused.rawMessage).toBe(
        `team '${otherTeam}' is not a team of this resource's organization, and a team can be granted only on its own organization's resources`,
      );
    });

    it("leaving the organization removes access through the team at once, and rejoining restores it", async () => {
      const policies = createClient(IamPolicyCommandController, as(ANA));
      await policies.revokeOrgAccess({ identityAccountId: VIC, org: ACME });
      expect(await canViewAgent(VIC, agentId)).toBe(false);
      await policies.create(grant(ref("identity_account", VIC), "viewer", ref("organization", ACME)));
      expect(await canViewAgent(VIC, agentId)).toBe(true);
    });

    it("deleting the team removes every row naming it, and the member's access with them", async () => {
      expect(rowsNaming("team", teamId)).toBeGreaterThan(0);
      await createClient(TeamCommandController, as(ANA)).delete({ resourceId: teamId });
      expect(rowsNaming("team", teamId)).toBe(0);
      expect(await canViewAgent(VIC, agentId)).toBe(false);
      expect(await teams.findById(teamId)).toBeUndefined();
    });

    it("deleting an organization removes its teams", async () => {
      await createOrganization("umbrella", OUTSIDER);
      const doomed = await createTeam("Doomed", "umbrella", OUTSIDER);
      await createClient(OrganizationCommandController, as(OUTSIDER)).delete({ value: "umbrella" });
      expect(await teams.listByOrg("umbrella")).toEqual([]);
      expect(rowsNaming("team", doomed)).toBe(0);
    });
  });

  describe("A create never keeps the id the caller sent", () => {
    interface MintRow {
      // The case's label: the RPC's tag, literal, then the kind.
      readonly title: string;
      // `<Service>.<method>`, as the completeness case keys it.
      readonly key: string;
      readonly kind: ApiResourceKind;
      // Sends the create in `org`, as its founder, with metadata.id set to
      // chosenId, and answers the id the server answered.
      send(org: string, chosenId: string): Promise<string>;
      // Reads the resource back by id, as the founder, and answers the id the read carries.
      read(id: string): Promise<string | undefined>;
    }

    function providerRequest(org: string, chosenId: string) {
      const issuer = `https://mint.${org}.test`;
      return {
        apiVersion: "iam.stigmer.ai/v1",
        kind: "IdentityProvider",
        metadata: { id: chosenId, name: "Mint Provider", org },
        spec: { displayName: "Mint Provider", ...publishedIssuer(issuer), expectedAudience: `${issuer}/stigmer` },
      };
    }

    const readProvider = async (id: string) =>
      (await createClient(IdentityProviderQueryController, as(FOUNDER)).get({ value: id })).metadata?.id;

    const ROWS: readonly MintRow[] = [
      {
        title: "[rpc:TeamCommandController.create] Team",
        key: "TeamCommandController.create",
        kind: ApiResourceKind.team,
        async send(org, chosenId) {
          const team = await createClient(TeamCommandController, as(FOUNDER)).create({
            apiVersion: "iam.stigmer.ai/v1",
            kind: "Team",
            metadata: { id: chosenId, name: "Mint Team", org },
            spec: { description: "a team created with an id the caller chose" },
          });
          return team.metadata?.id ?? "";
        },
        async read(id) {
          return (await createClient(TeamQueryController, as(FOUNDER)).get({ value: id })).metadata?.id;
        },
      },
      {
        title: "[rpc:InvitationCommandController.create] Invitation",
        key: "InvitationCommandController.create",
        kind: ApiResourceKind.invitation,
        async send(org, chosenId) {
          const invitation = await createClient(InvitationCommandController, as(FOUNDER)).create({
            apiVersion: "iam.stigmer.ai/v1",
            kind: "Invitation",
            metadata: { id: chosenId, name: "mint-invite", org },
            spec: {
              role: IamRole.viewer,
              maxRedemptions: 1,
              expiresAt: timestampFromDate(new Date(Date.now() + 7 * DAY_MS)),
              label: "an invitation created with an id the caller chose",
            },
          });
          return invitation.metadata?.id ?? "";
        },
        async read(id) {
          return (await createClient(InvitationQueryController, as(FOUNDER)).get({ value: id })).metadata?.id;
        },
      },
      {
        title: "[rpc:IdentityProviderCommandController.create] IdentityProvider",
        key: "IdentityProviderCommandController.create",
        kind: ApiResourceKind.identity_provider,
        async send(org, chosenId) {
          const provider = await createClient(IdentityProviderCommandController, as(FOUNDER)).create(
            providerRequest(org, chosenId),
          );
          return provider.metadata?.id ?? "";
        },
        read: readProvider,
      },
      {
        title: "[rpc:IdentityProviderCommandController.apply] IdentityProvider (apply as a create)",
        key: "IdentityProviderCommandController.apply",
        kind: ApiResourceKind.identity_provider,
        async send(org, chosenId) {
          const provider = await createClient(IdentityProviderCommandController, as(FOUNDER)).apply(
            providerRequest(org, chosenId),
          );
          return provider.metadata?.id ?? "";
        },
        read: readProvider,
      },
    ];

    // Each case is a [title, row] pair so `%s` prints the title verbatim,
    // the tag first, as the OSS suite prints its rows.
    it.for(ROWS.map((row, index) => [row.title, row, index] as const))(
      "%s: the caller's id is replaced by the server's, and the resource reads back under it",
      async ([, row, index]) => {
        const prefix = kindMetaOf(row.kind).idPrefix;
        const chosenId = foreignId(prefix);
        const org = `mint-${index}-${prefix}`;
        await createOrganization(org, FOUNDER);

        const answered = await row.send(org, chosenId);

        expect(answered, `${row.key} kept the caller's id ${chosenId}; the server must assign its own`).not.toBe(chosenId);
        expect(answered, `${row.key} answered id ${answered}, not a ${prefix}_ id the server minted`).toMatch(
          mintedIdPattern(prefix),
        );
        expect(await row.read(answered), `${row.key}: a read of ${answered}`).toBe(answered);
      },
    );

    it("has a row for every create and apply the unit serves whose request carries metadata, and no other", () => {
      const needingRow: string[] = [];
      for (const service of served) {
        for (const method of service.methods) {
          if (method.name !== "create" && method.name !== "apply") continue;
          // The OSS inventory's exemption: an input with no metadata carries no id to choose.
          if (method.input.fields.every((field) => field.name !== "metadata")) continue;
          needingRow.push(`${service.name}.${method.name}`);
        }
      }
      expect(served.length, "services the unit registers (an empty walk would pass vacuously)").toBeGreaterThan(0);
      const keyed = ROWS.map((row) => row.key);
      expect(
        {
          missing: needingRow.filter((key) => !keyed.includes(key)).sort(),
          extra: keyed.filter((key) => !needingRow.includes(key)).sort(),
        },
        "the unit's creates and ROWS disagree: add a row for a new create, or drop the row of one that is gone",
      ).toEqual({ missing: [], extra: [] });
    });
  });
});
