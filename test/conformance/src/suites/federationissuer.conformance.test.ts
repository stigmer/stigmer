// Conformance suite for the FederationIssuer domain: an outside sign-in
// provider an organization's admin registers, whose people the server then
// lets in with the role the admin chose (Class A; no runner).
// Domain: iam / federationissuer.
//
// Drives FederationIssuerCommandController and FederationIssuerQueryController
// through the raw proto stubs, with real people from the target's enforcing
// lane. A save that names an issuer reads the issuer's discovery document
// and key set, so the arms split by what the server can dial:
//
// Where `federationIssuers` is true (enterprise, cloud), hermetically — an
// issuer that names no allowed issuer and no key set dials nothing:
//   - an admin creates one, reads it by id, by slug and in the list, updates
//     its display name under a mask (refused without one), renames it,
//     applies it (create, then update) and deletes it; an outsider reads
//     nothing and a plain member creates nothing;
//   - the refusals decided before any dial: an `http:` issuer, an owner
//     sign-in role, and the server's own sign-in issuer
//     (TargetProfile.signInIssuer), each INVALID_ARGUMENT with its copy.
// Where `outboundEgress` is `strict` (cloud), an issuer on a loopback address
// is refused with the egress copy, "not at an address this platform can
// reach". That the address is never dialed cannot be seen from outside the
// server; Enterprise's composed suite, which sees the dialer, pins it
// (ee/server/src/editions/__tests__/enterprise-host-wiring.postgres.test.ts).
// Where `outboundEgress` is `relaxed` (enterprise), through a real TLS issuer
// the server trusts (TargetProfile.startOutsideIssuer): an issuer naming it
// is saved, a token it mints signs a new person in with an account made at
// that first sign-in and the issuer's role on the organization, a token for
// another audience is UNAUTHENTICATED, and deleting the issuer ends its
// sign-ins.
// Where `licenseStatus` is `licensed` (enterprise), a licensed sibling with
// no egress setting, the default an operator gets, refuses the same
// loopback issuer.
// Where `federationIssuers` is false (open source), every FederationIssuer
// RPC answers Unimplemented, pinned once per RPC.
//
// Deliberately out of scope: the federated identity-account RPCs, whose
// positive lane belongs to the identity-account suite (stigmer#2324);
// `external_id_claim` routing into child organizations and the userinfo
// endpoint, which Enterprise's composed and handler suites pin.
import { clone } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { FederationIssuerSchema, type FederationIssuer } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { FederationIssuerCommandController } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/command_pb";
import { FederationIssuerQueryController } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/query_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { startLocalOidcIssuer, type LocalOidcIssuer } from "@stigmer/test-support/local-oidc-issuer";
import { UNREACHABLE_HOST_PORT } from "@stigmer/test-support/ports";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { ref } from "../support/iampolicies";
import { freshSubject } from "../support/identityaccounts";
import type { InitShape } from "../support/init-shape";
import { uniqueName } from "../support/naming";
import { createUniqueOrganization } from "../support/organizations";
import { createTarget, enforcingLaneOf, type EnforcingLane, type TargetProfile, type TenancyContext } from "../targets";

// Collection-time capability read (the billing suites' pattern).
const capabilities = createTarget().capabilities;
const issuersServed = capabilities.federationIssuers;

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

// The proto's annotation copy (federationissuer/v1/command.proto, query.proto),
// the contract's own rule (spec.proto) and the validation matrix's pinned
// copy (ee/server/src/iam/issuer/validation.ts), which the console shows the
// admin as it is.
const COPY = {
  createDenied: "unauthorized to create federation issuer in this organization",
  viewDenied: "unauthorized to view federation issuer",
  listDenied: "unauthorized to list federation issuers in this organization",
  ownerSignInRole: "sign_in_role cannot be owner; organization ownership must be assigned explicitly",
  httpsRequired: (issuer: string) => `Issuer must use HTTPS: ${issuer}`,
  reserved: (issuer: string) =>
    `Issuer '${issuer}' is this platform's own sign-in issuer and cannot be an organization's federation issuer.`,
  unreachable: (issuer: string) =>
    `The discovery document of issuer '${issuer}' is not at an address this platform can reach.`,
} as const;

// A loopback issuer nothing listens on: a strict server refuses the address
// before dialing, and a relaxed one fails fast with other copy, never hangs.
const LOOPBACK_ISSUER = `https://${UNREACHABLE_HOST_PORT}`;

interface IssuerInput {
  readonly org: string;
  readonly slug?: string;
  readonly displayName?: string;
  readonly issuers?: ReadonlyArray<string>;
  readonly jwksUri?: string;
  readonly audience?: string;
  readonly signInRole?: IamRole;
  readonly createAccountsOnSignIn?: boolean;
}

// An issuer naming no allowed issuer and no key set unless told to, so its
// save dials nothing. The audience is unique per call: a route (issuer,
// audience) belongs to one registration on the whole server.
function makeIssuer(input: IssuerInput): InitShape<typeof FederationIssuerSchema> {
  const slug = input.slug ?? uniqueName("issuer");
  return {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "FederationIssuer",
    metadata: { name: slug, slug, org: input.org },
    spec: {
      displayName: input.displayName ?? "Conformance sign-in",
      allowedIssuers: [...(input.issuers ?? [])],
      jwksUri: input.jwksUri ?? "",
      expectedAudience: input.audience ?? `stigmer:${uniqueName("aud")}`,
      signInRole: input.signInRole ?? IamRole.iam_role_unspecified,
      createAccountsOnSignIn: input.createAccountsOnSignIn ?? false,
    },
  };
}

// An issuer naming `issuer`, with the key set its discovery document
// publishes (the save requires the two to agree).
function naming(org: string, issuer: string, extra: Omit<IssuerInput, "org" | "issuers" | "jwksUri"> = {}) {
  return makeIssuer({ org, issuers: [issuer], jwksUri: `${issuer}/jwks`, ...extra });
}

async function requireLane(): Promise<EnforcingLane> {
  const enforcing = await enforcingLaneOf(target);
  if (enforcing.lane === undefined) {
    throw new Error(`target ${target.name} declares federationIssuers but lends no enforcing lane: ${enforcing.reason}`);
  }
  return enforcing.lane;
}

// The roles a principal holds on the organization, read by its owner.
async function organizationRolesOf(org: string, accountId: string): Promise<string[]> {
  const { roles } = await clients.iamPolicyQuery.getPrincipalResourceRoles({
    principal: ref("identity_account", accountId),
    resource: ref("organization", org),
  });
  return roles.map((role) => role.code);
}

describe.skipIf(!issuersServed)("FederationIssuer conformance — the issuer lane (federationIssuers served)", () => {
  let lane: EnforcingLane;
  let tenancy: TenancyContext;
  let org: string;
  let admin: ConformanceClients;
  let member: ConformanceClients;
  let outsider: ConformanceClients;

  beforeAll(async () => {
    lane = await requireLane();
    tenancy = await lane.provisionTenancy();
    org = tenancy.org;
    admin = await lane.provisionWithRole(tenancy, "admin");
    member = await lane.provisionMember(tenancy);
    outsider = await lane.provisionIdentity();
  });

  afterAll(async () => {
    if (tenancy !== undefined) await lane.cleanupTenancy(tenancy);
  });

  // An issuer the admin registers, deleted at cleanup.
  async function register(input: Omit<IssuerInput, "org"> = {}): Promise<FederationIssuer> {
    const issuer = await admin.federationIssuerCommand.create(makeIssuer({ org, ...input }));
    fixtures.defer(() => clients.federationIssuerCommand.delete({ resourceId: issuer.metadata?.id ?? "" }));
    return issuer;
  }

  it("[rpc:FederationIssuerCommandController.create] an admin registers an issuer: the answer carries its id and the spec as sent; a plain member registers none", async () => {
    const slug = uniqueName("acme-okta");
    const audience = `stigmer:${uniqueName("acme")}`;
    const issuer = await register({ slug, displayName: "Acme Okta", audience, signInRole: IamRole.viewer });

    expect(issuer.metadata?.id).toMatch(/^fis_/);
    expect(issuer.metadata?.org).toBe(org);
    expect(issuer.metadata?.slug).toBe(slug);
    expect(issuer.spec?.displayName).toBe("Acme Okta");
    expect(issuer.spec?.expectedAudience).toBe(audience);
    expect(issuer.spec?.signInRole).toBe(IamRole.viewer);

    const refused = await expectGrpcCode(
      () => member.federationIssuerCommand.create(makeIssuer({ org })),
      Code.PermissionDenied,
      "a member's issuer",
    );
    expect(refused.rawMessage).toBe(COPY.createDenied);
  });

  it("[rpc:FederationIssuerQueryController.get] [rpc:FederationIssuerQueryController.getByReference] [rpc:FederationIssuerQueryController.list] an admin reads an issuer by id, by slug and in the list; an outsider is refused", async () => {
    const issuer = await register();
    const id = issuer.metadata?.id ?? "";
    const slug = issuer.metadata?.slug ?? "";

    expect((await admin.federationIssuerQuery.get({ value: id })).metadata?.slug).toBe(slug);
    const byReference = await admin.federationIssuerQuery.getByReference({
      org,
      kind: ApiResourceKind.federation_issuer,
      slug,
    });
    expect(byReference.metadata?.id).toBe(id);
    const { entries } = await admin.federationIssuerQuery.list({ org });
    expect(entries.map((entry) => entry.metadata?.id)).toContain(id);

    const get = await expectGrpcCode(() => outsider.federationIssuerQuery.get({ value: id }), Code.PermissionDenied, "an outsider's get");
    expect(get.rawMessage).toBe(COPY.viewDenied);
    await expectGrpcCode(
      () => outsider.federationIssuerQuery.getByReference({ org, kind: ApiResourceKind.federation_issuer, slug }),
      Code.PermissionDenied,
      "an outsider's getByReference",
    );
    const list = await expectGrpcCode(() => outsider.federationIssuerQuery.list({ org }), Code.PermissionDenied, "an outsider's list");
    expect(list.rawMessage).toBe(COPY.listDenied);
  });

  it("[rpc:FederationIssuerCommandController.update] update changes the display name the mask names, and a request without a mask is INVALID_ARGUMENT", async () => {
    const issuer = await register({ displayName: "Before" });

    const changed = clone(FederationIssuerSchema, issuer);
    if (changed.spec !== undefined) changed.spec.displayName = "After";
    const updated = await admin.federationIssuerCommand.update({ resource: changed, updateMask: { paths: ["spec.display_name"] } });
    expect(updated.metadata?.id).toBe(issuer.metadata?.id);
    expect(updated.spec?.displayName).toBe("After");
    expect(updated.spec?.expectedAudience, "what the mask does not name is kept").toBe(issuer.spec?.expectedAudience);

    await expectGrpcCode(
      () => admin.federationIssuerCommand.update({ resource: changed }),
      Code.InvalidArgument,
      "an update without a mask",
    );
  });

  it("[rpc:FederationIssuerCommandController.rename] rename moves the slug and keeps the id, and the new slug finds the issuer", async () => {
    const issuer = await register();
    const slug = uniqueName("acme-sso");

    const renamed = await admin.federationIssuerCommand.rename({ resourceId: issuer.metadata?.id ?? "", slug });
    expect(renamed.metadata?.id).toBe(issuer.metadata?.id);
    expect(renamed.metadata?.slug).toBe(slug);
    const found = await clients.federationIssuerQuery.getByReference({ org, kind: ApiResourceKind.federation_issuer, slug });
    expect(found.metadata?.id).toBe(issuer.metadata?.id);
  });

  it("[rpc:FederationIssuerCommandController.apply] apply creates the issuer on the first call and updates it on the second (same slug and organization)", async () => {
    const slug = uniqueName("applied");
    const audience = `stigmer:${uniqueName("applied")}`;

    const created = await admin.federationIssuerCommand.apply(makeIssuer({ org, slug, audience, displayName: "First" }));
    const id = created.metadata?.id ?? "";
    fixtures.defer(() => clients.federationIssuerCommand.delete({ resourceId: id }));
    expect(id).toMatch(/^fis_/);
    expect(created.spec?.displayName).toBe("First");

    const updated = await admin.federationIssuerCommand.apply(makeIssuer({ org, slug, audience, displayName: "Second" }));
    expect(updated.metadata?.id).toBe(id);
    expect(updated.spec?.displayName).toBe("Second");
  });

  it("[rpc:FederationIssuerCommandController.delete] delete answers the issuer, and it is gone", async () => {
    const issuer = await admin.federationIssuerCommand.create(makeIssuer({ org }));
    const id = issuer.metadata?.id ?? "";

    const deleted = await admin.federationIssuerCommand.delete({ resourceId: id });
    expect(deleted.metadata?.id).toBe(id);
    await expectGrpcCode(() => admin.federationIssuerQuery.get({ value: id }), Code.NotFound, "the deleted issuer");
  });

  it("[rpc:FederationIssuerCommandController.create] refuses, before dialing anything, an http issuer, an owner sign-in role, and the server's own sign-in issuer", async () => {
    if (target.signInIssuer === undefined) {
      throw new Error(`target ${target.name} declares federationIssuers but provides no signInIssuer()`);
    }
    const plain = "http://127.0.0.1:1";
    const http = await expectGrpcCode(
      () => admin.federationIssuerCommand.create(naming(org, plain)),
      Code.InvalidArgument,
      "an http issuer",
    );
    expect(http.rawMessage).toBe(COPY.httpsRequired(plain));

    const owner = await expectGrpcCode(
      () => admin.federationIssuerCommand.create(makeIssuer({ org, signInRole: IamRole.owner })),
      Code.InvalidArgument,
      "an owner sign-in role",
    );
    expect(owner.rawMessage).toContain(COPY.ownerSignInRole);

    // The issuer as the server compares it: without the trailing slash some
    // tenants publish (ee/server/src/iam/issuer/issuer-url.ts).
    const own = target.signInIssuer().replace(/\/+$/, "");
    const reserved = await expectGrpcCode(
      () => admin.federationIssuerCommand.create(naming(org, own)),
      Code.InvalidArgument,
      "the server's own sign-in issuer",
    );
    expect(reserved.rawMessage).toBe(COPY.reserved(own));
  });
});

describe.skipIf(!issuersServed || capabilities.outboundEgress !== "strict")(
  "FederationIssuer conformance — a strict server's egress (outboundEgress strict)",
  () => {
    it("[rpc:FederationIssuerCommandController.create] an issuer on a loopback address is refused as not reachable from this platform", async () => {
      const tenancy = await target.provisionTenancy();
      fixtures.defer(() => target.cleanupTenancy(tenancy));

      const refused = await expectGrpcCode(
        () => clients.federationIssuerCommand.create(naming(tenancy.org, LOOPBACK_ISSUER)),
        Code.InvalidArgument,
        "a loopback issuer under strict egress",
      );
      expect(refused.rawMessage).toBe(COPY.unreachable(LOOPBACK_ISSUER));
    });
  },
);

describe.skipIf(!issuersServed || capabilities.outboundEgress !== "relaxed")(
  "FederationIssuer conformance — an outside provider's people sign in (outboundEgress relaxed)",
  () => {
    let lane: EnforcingLane;
    let provider: LocalOidcIssuer | undefined;

    beforeAll(async () => {
      lane = await requireLane();
      if (target.startOutsideIssuer === undefined) {
        throw new Error(`target ${target.name} declares federationIssuers on a relaxed primary but provides no startOutsideIssuer()`);
      }
      provider = await target.startOutsideIssuer();
    });

    afterAll(async () => {
      await provider?.close();
    });

    function requireProvider(): LocalOidcIssuer {
      if (provider === undefined) throw new Error("the outside issuer did not start");
      return provider;
    }

    // An issuer naming the outside provider, registered by the founder in a
    // tenancy of its own, granting `viewer` at a first sign-in.
    async function federate(): Promise<{ org: string; issuer: FederationIssuer; audience: string }> {
      const tenancy = await lane.provisionTenancy();
      fixtures.defer(() => lane.cleanupTenancy(tenancy));
      const audience = `stigmer:${uniqueName("acme")}`;
      const issuer = await clients.federationIssuerCommand.create(
        naming(tenancy.org, requireProvider().issuer, { audience, signInRole: IamRole.viewer, createAccountsOnSignIn: true }),
      );
      fixtures.defer(() => clients.federationIssuerCommand.delete({ resourceId: issuer.metadata?.id ?? "" }));
      return { org: tenancy.org, issuer, audience };
    }

    it("[rpc:FederationIssuerCommandController.create] an issuer naming a reachable provider is saved, and the provider's people sign in with the role it grants; a token for another audience is UNAUTHENTICATED", async () => {
      const outside = requireProvider();
      const { org, issuer, audience } = await federate();
      expect(issuer.spec?.allowedIssuers).toEqual([outside.issuer]);
      expect(issuer.spec?.jwksUri).toBe(`${outside.issuer}/jwks`);

      const email = `${uniqueName("dana")}@acme.example`;
      const dana = target.clientsPresenting(await outside.mint({ sub: freshSubject(), email, audience }));
      const account = await dana.identityAccountQuery.whoAmI({});
      expect(account.spec?.email).toBe(email);
      expect(account.spec?.federationIssuerRef?.slug).toBe(issuer.metadata?.slug);
      expect(await organizationRolesOf(org, account.metadata?.id ?? "")).toEqual(["viewer"]);

      const elsewhere = target.clientsPresenting(
        await outside.mint({ sub: freshSubject(), email, audience: `stigmer:${uniqueName("other")}` }),
      );
      await expectGrpcCode(() => elsewhere.identityAccountQuery.whoAmI({}), Code.Unauthenticated, "a token for another audience");
    });

    it("[rpc:FederationIssuerCommandController.delete] deleting the issuer ends its sign-ins", async () => {
      const outside = requireProvider();
      const { issuer, audience } = await federate();
      const token = await outside.mint({ sub: freshSubject(), email: `${uniqueName("erin")}@acme.example`, audience });
      await target.clientsPresenting(token).identityAccountQuery.whoAmI({});

      await clients.federationIssuerCommand.delete({ resourceId: issuer.metadata?.id ?? "" });
      await expectGrpcCode(
        () => target.clientsPresenting(token).identityAccountQuery.whoAmI({}),
        Code.Unauthenticated,
        "a token of a deleted issuer",
      );
    });
  },
);

describe.skipIf(!issuersServed || capabilities.licenseStatus !== "licensed")(
  "FederationIssuer conformance — a licensed server's default egress (licenseStatus licensed)",
  () => {
    it("[rpc:FederationIssuerCommandController.create] a licensed server with no egress setting refuses an issuer on a loopback address", async () => {
      if (target.spawnSibling === undefined) {
        throw new Error(`target ${target.name} is licensed but cannot spawn a sibling`);
      }
      const issuer = await startLocalOidcIssuer();
      fixtures.defer(() => issuer.close());
      const founderToken = await issuer.mint({ sub: freshSubject(), email: "founder@conformance.example.com" });
      // Blank reads as the edition's default, so a developer's shell
      // cannot change what this server runs with.
      const sibling = await target.spawnSibling({
        env: { STIGMER_OIDC_ISSUER: issuer.issuer, STIGMER_OIDC_AUDIENCE: issuer.audience, STIGMER_OUTBOUND_EGRESS: "" },
        readinessBearer: founderToken,
      });
      fixtures.defer(() => sibling.teardown());
      const founder = sibling.clientsPresenting(founderToken);
      await founder.identityAccountCommand.provisionMyAccount({});
      const { id: org } = await createUniqueOrganization(founder.organizationCommand, "the default-egress sibling");

      const refused = await expectGrpcCode(
        () => founder.federationIssuerCommand.create(naming(org, LOOPBACK_ISSUER)),
        Code.InvalidArgument,
        "a loopback issuer under the default egress",
      );
      expect(refused.rawMessage).toBe(COPY.unreachable(LOOPBACK_ISSUER));
    });
  },
);

describe.skipIf(issuersServed)("FederationIssuer conformance — the OSS boundary (no FederationIssuer service routed)", () => {
  it("[rpc:FederationIssuerCommandController.apply] [rpc:FederationIssuerCommandController.create] [rpc:FederationIssuerCommandController.update] [rpc:FederationIssuerCommandController.rename] [rpc:FederationIssuerCommandController.delete] [rpc:FederationIssuerQueryController.get] [rpc:FederationIssuerQueryController.getByReference] [rpc:FederationIssuerQueryController.list] every FederationIssuer RPC answers Unimplemented where federationIssuers is false", async () => {
    const org = "conformance-oss-boundary";
    const lanes: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
      ["FederationIssuer.apply", () => clients.federationIssuerCommand.apply(makeIssuer({ org }))],
      ["FederationIssuer.create", () => clients.federationIssuerCommand.create(makeIssuer({ org }))],
      [
        "FederationIssuer.update",
        () => clients.federationIssuerCommand.update({ resource: { metadata: { id: "fis_x" } }, updateMask: { paths: ["spec.display_name"] } }),
      ],
      ["FederationIssuer.rename", () => clients.federationIssuerCommand.rename({ resourceId: "fis_x", slug: "renamed" })],
      ["FederationIssuer.delete", () => clients.federationIssuerCommand.delete({ resourceId: "fis_x" })],
      ["FederationIssuer.get", () => clients.federationIssuerQuery.get({ value: "fis_x" })],
      [
        "FederationIssuer.getByReference",
        () => clients.federationIssuerQuery.getByReference({ org, kind: ApiResourceKind.federation_issuer, slug: "boundary" }),
      ],
      ["FederationIssuer.list", () => clients.federationIssuerQuery.list({ org })],
    ];
    // Every method the two controllers declare, so a new RPC on the
    // contract fails here until its boundary is pinned.
    const declared = FederationIssuerCommandController.methods.length + FederationIssuerQueryController.methods.length;
    expect(lanes, "one lane per declared RPC").toHaveLength(declared);
    for (const [name, op] of lanes) {
      await expectGrpcCode(op, Code.Unimplemented, `OSS ${name}`);
    }
  });
});
