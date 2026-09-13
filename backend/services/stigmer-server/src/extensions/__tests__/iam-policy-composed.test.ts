/**
 * Pins the built-in authorization POSTURE end to end (20260913.01,
 * T01_1_review.md Q-OR-6): `builtInAuthorization = extensions.authorizer
 * === undefined`, named once in compose.ts. The open-source membership
 * rules and the built-in role lifecycle exist to feed the built-in
 * authorizer; a composition that registers its OWN Authorizer has its own
 * onboarding (the cloud's invitations, its personal-organization step, its
 * tuple driver) and must get neither of them — otherwise every cloud
 * organization create would write a second, unasked-for `owner` row and
 * every first sign-in would hand out roles the cloud never granted.
 *
 * The NEGATIVE proof, over a composed server in the cloud's own shape (a
 * declared require-authentication posture, the unit's verifier, the unit's
 * Authorizer, no lifecycle driver): an organization created by a signed-in
 * subject leaves NO policy row; the creator's first provisioning writes
 * none (no ownership heal); a second subject's first provisioning writes
 * none (no membership). Green before the domain lands and green after by
 * design: its value is at the slice that wires compose.ts, where an
 * unconditional install turns it red. Every negative assertion sits beside
 * a positive one (the create succeeded, the accounts exist, the unit's
 * Authorizer WAS consulted) so the file cannot pass vacuously.
 *
 * The POSITIVE proof of the WIRING (slice 4), through real boots on both
 * open-source postures:
 *   - OIDC with no Authorizer (the unit's verifier alone): the creator
 *     founds an organization idp-shaped → no row yet; provisions → one
 *     `owner` row, stamped by the account; founds a SECOND organization
 *     after provisioning (the verifier still stamps the raw subject) → its
 *     owner row lands through the subject read of `accountForCaller`
 *     (Q-S4-1); a newcomer provisions → one `member` row per organization;
 *     provisions again → nothing new;
 *   - trusted-local: an organization created over the wire is owned by the
 *     operator's account; a second boot on the same database writes
 *     nothing (Q-S4-3); an owner row deleted underneath is written back at
 *     the next boot (Q-OR-6c).
 * The positive proof of the RPCs over these rows is
 * domain/iampolicy/__tests__/iampolicy.test.ts (slice 5).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fromBinary } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { policyIdFor } from "../../domain/iampolicy/constants.js";
import { orgRole } from "../../domain/iampolicy/__tests__/support.js";
import {
  accountIdFor,
  localIdpIdFor,
} from "../../domain/identityaccount/constants.js";
import {
  resetOperatorIdentityForTests,
  setOperatorIdentity,
} from "../../pipeline/steps/defaults.js";
import type { Authorizer } from "../authorizer.js";
import type { ServerExtension } from "../registry.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "./composed-support.js";

const CREATOR = "fake|creator";
const NEWCOMER = "fake|newcomer";

/** The policy rows a composed server's store holds, decoded — the one observation every describe below is about. */
async function policiesIn(server: ComposedServer): Promise<IamPolicy[]> {
  const rows = await server.store.listResources(ApiResourceKind.iam_policy);
  return rows.map((row) => fromBinary(IamPolicySchema, row));
}

/** `<relation>@<organization>` for every row `accountId` holds, sorted. */
function rolesHeldBy(
  policies: ReadonlyArray<IamPolicy>,
  accountId: string,
): ReadonlyArray<string> {
  return policies
    .filter((p) => p.spec?.principal?.id === accountId)
    .map((p) => `${p.spec?.relation}@${p.spec?.resource?.id}`)
    .sort();
}

function organizationInput(slug: string) {
  return {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug, org: "" },
    spec: { description: slug },
  };
}

describe("iam-policy posture (composed server, a unit's own Authorizer: nothing built in is installed)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let authorizerCalls = 0;

  /** Allows everything and counts — the proof the posture switch saw a registered Authorizer. */
  const permissiveAuthorizer: Authorizer = {
    authorize: () => {
      authorizerCalls += 1;
      return Promise.resolve({ kind: "allow" });
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "iam-policy-composed-"));
    const unit: ServerExtension = {
      name: "fake-iam",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
      authorizer: permissiveAuthorizer,
    };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  /** The policy rows the composed server's store holds — the one observation the posture is about. */
  async function policyRows(): Promise<ReadonlyArray<string>> {
    const rows = await server.store.listResources(ApiResourceKind.iam_policy);
    return rows.map(
      (row) => fromBinary(IamPolicySchema, row).metadata?.id ?? "",
    );
  }

  it("an organization created by a signed-in subject leaves no policy row — the built-in role lifecycle is not installed", async () => {
    const asCreator = transportFor(
      port,
      fakeJwt(CREATOR, "creator@example.com"),
    );
    const created = await createClient(
      OrganizationCommandController,
      asCreator,
    ).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: "posture-org", slug: "posture-org", org: "" },
      spec: { description: "created under a unit's own Authorizer" },
    });
    // Organization create is `is_skip_authorization` by annotation (anyone
    // may found one), so the proof that the posture switch saw a registered
    // Authorizer is the read that follows: `get` is annotated can_view.
    await createClient(OrganizationQueryController, asCreator).get({
      value: "posture-org",
    });

    expect(created.metadata?.id, "the create itself succeeded").toBe(
      "posture-org",
    );
    expect(
      authorizerCalls,
      "the unit's Authorizer was consulted",
    ).toBeGreaterThan(0);
    expect(await policyRows()).toEqual([]);
  });

  it("the creator's first provisioning writes no row — the membership rules' ownership heal is not installed", async () => {
    const account = await createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(CREATOR, "creator@example.com")),
    ).provisionMyAccount({});

    expect(account.metadata?.id).toBe(accountIdFor(CREATOR));
    expect(await policyRows()).toEqual([]);
  });

  it("a newcomer's first provisioning writes no row — no membership is handed out", async () => {
    const account = await createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(NEWCOMER, "newcomer@example.com")),
    ).provisionMyAccount({});

    expect(account.metadata?.id).toBe(accountIdFor(NEWCOMER));
    expect(await policyRows()).toEqual([]);
  });
});

describe("built-in authorization posture (composed server, OIDC with no Authorizer: both rules are installed)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  const creatorId = accountIdFor(CREATOR);
  const newcomerId = accountIdFor(NEWCOMER);

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "iam-policy-built-in-oidc-"));
    // The unit vouches for tokens and declares the posture, and registers
    // NO Authorizer — the open-source OIDC self-host's shape.
    const unit: ServerExtension = {
      name: "fake-oidc-only",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
    };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("an organization founded idp-shaped, before any account exists, leaves no row yet", async () => {
    const created = await createClient(
      OrganizationCommandController,
      transportFor(port, fakeJwt(CREATOR, "creator@example.com")),
    ).create(organizationInput("founded-before"));

    expect(created.metadata?.id).toBe("founded-before");
    expect(await policiesIn(server)).toEqual([]);
  });

  it("the founder's first provisioning writes exactly one owner row, stamped by the account", async () => {
    const account = await createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(CREATOR, "creator@example.com")),
    ).provisionMyAccount({});
    expect(account.metadata?.id).toBe(creatorId);

    const policies = await policiesIn(server);
    expect(rolesHeldBy(policies, creatorId)).toEqual(["owner@founded-before"]);
    expect(policies).toHaveLength(1);
    expect(policies[0]?.metadata?.id).toBe(
      policyIdFor(orgRole(creatorId, "owner", "founded-before")),
    );
    expect(policies[0]?.status?.audit?.specAudit?.createdBy?.id).toBe(
      creatorId,
    );
  });

  it("an organization founded AFTER provisioning is owned through the subject read — the verifier still stamps the raw subject", async () => {
    await createClient(
      OrganizationCommandController,
      transportFor(port, fakeJwt(CREATOR, "creator@example.com")),
    ).create(organizationInput("founded-after"));

    const policies = await policiesIn(server);
    expect(rolesHeldBy(policies, creatorId)).toEqual([
      "owner@founded-after",
      "owner@founded-before",
    ]);
    expect(
      policies.find((p) => p.spec?.resource?.id === "founded-after")?.status
        ?.audit?.specAudit?.createdBy?.id,
    ).toBe(creatorId);
  });

  it("a newcomer's first provisioning makes them a member of every organization; provisioning again writes nothing", async () => {
    const asNewcomer = transportFor(
      port,
      fakeJwt(NEWCOMER, "newcomer@example.com"),
    );
    const accounts = createClient(IdentityAccountCommandController, asNewcomer);

    await accounts.provisionMyAccount({});
    const after = (await policiesIn(server)).map((p) => p.metadata?.id).sort();
    await accounts.provisionMyAccount({});

    const policies = await policiesIn(server);
    expect(rolesHeldBy(policies, newcomerId)).toEqual([
      "member@founded-after",
      "member@founded-before",
    ]);
    expect(policies.map((p) => p.metadata?.id).sort()).toEqual(after);
  });
});

describe("built-in authorization posture (composed server, trusted-local: the operator owns what the laptop has)", () => {
  const OPERATOR_EMAIL = "operator@example.com";
  const operatorId = accountIdFor(localIdpIdFor(OPERATOR_EMAIL));
  let dir: string;
  let server: ComposedServer;
  let port: number;

  /** One boot on the describe's directory — the same database every time. */
  async function boot(): Promise<void> {
    server = await composeServer({
      config: loadConfig({
        ...baseConfig(dir),
        STIGMER_OPERATOR_EMAIL: OPERATOR_EMAIL,
        STIGMER_OPERATOR_NAME: "The Operator",
      }),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "iam-policy-built-in-local-"));
    setOperatorIdentity(OPERATOR_EMAIL, "The Operator");
    await boot();
  });

  afterAll(async () => {
    await server.shutdown();
    resetOperatorIdentityForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("an organization created over the wire is owned by the operator's account — the caller carried an email, the row names the account", async () => {
    await createClient(
      OrganizationCommandController,
      transportFor(port),
    ).create(organizationInput("laptop-org"));

    const policies = await policiesIn(server);
    expect(rolesHeldBy(policies, operatorId)).toEqual(["owner@laptop-org"]);
    expect(policies[0]?.status?.audit?.specAudit?.createdBy?.id).toBe(
      operatorId,
    );
  });

  it("a second boot on the same database writes nothing — the organization already has an owner", async () => {
    const before = (await policiesIn(server)).map((p) => p.metadata?.id);
    await server.shutdown();

    await boot();

    expect((await policiesIn(server)).map((p) => p.metadata?.id)).toEqual(
      before,
    );
  });

  it("an owner row deleted underneath the server is written back at the next boot", async () => {
    const [row] = await policiesIn(server);
    expect(row?.metadata?.id).toBeDefined();
    await server.store.deleteResource(
      ApiResourceKind.iam_policy,
      row?.metadata?.id ?? "",
    );
    expect(await policiesIn(server)).toEqual([]);
    await server.shutdown();

    await boot();

    expect(rolesHeldBy(await policiesIn(server), operatorId)).toEqual([
      "owner@laptop-org",
    ]);
  });
});
