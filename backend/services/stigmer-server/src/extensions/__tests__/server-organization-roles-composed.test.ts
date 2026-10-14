/**
 * Pins, end to end, the roles on the organization a one-organization server
 * makes itself under sign-in, when the store it boots on already holds people
 * (domain/grant/membership.ts `ensureRolesOnServerOrganization`).
 *
 * Three boots over ONE data directory:
 *   1. A server that holds any number of organizations (an older open-source
 *      release): two people sign in, oldest first, and nobody makes an
 *      organization. The role reconciliation runs, over none.
 *   2. The same directory boots as a one-organization server: it makes
 *      `stigmer` as nobody, and the people it already held get their roles
 *      on it, as each person's own, in sign-in order. With no operator email
 *      configured the first person owns it and the second is a member, as
 *      their first sign-ins would have answered; both find it.
 *   3. The owner removes the member, and the directory boots once more: the
 *      member's row does not come back. The pass is once per database (its
 *      marker), so a role revoked after it stays revoked.
 *
 * And a laptop that turns sign-in on, over one directory: a trusted-local
 * one-organization server makes `stigmer` as the laptop's operator account,
 * which owns it; booted again with sign-in and no operator email, the first
 * person to sign in owns it and the next is a member, as on a fresh sign-in
 * install. The laptop account's stamp and owner row are nobody's on that
 * organization (domain/grant/membership.ts). The same holds for an
 * organization an older release's laptop made (`acme`, through its console
 * or CLI): the one organization a server holds is the server's, whoever
 * made it.
 *
 * And a sign-in install upgraded with its one organization: a member an
 * admin removed before the upgrade stays removed after it, and an operator
 * who signed in before it keeps the admin role they had (no role changes at
 * boot; one who first signs in after the upgrade owns it). Only a store the
 * server made its organization on owes its people their roles.
 *
 * And a server that cannot make its organization (its slug still held by a
 * create that was interrupted moments before, so the claim is too young to
 * count as abandoned): the organization a person makes in the console later
 * owes nobody a role, so a member removed there stays removed across a
 * reboot.
 *
 * Every organization is filed under a minted id (org_<ulid>), so the record
 * of the server's organization and every role row name that id, while
 * `stigmer` and `acme` stay the slugs people name them by.
 *
 * The unit vouches for unsigned JWT-shaped tokens and declares the
 * require-authentication posture with no Authorizer (composed-support.ts),
 * the open-source sign-in shape role-reconciliation-composed.test.ts boots;
 * the one-organization boots add `orgLimit: 1`, the open-source edition's
 * declaration.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fromBinary } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import { GrantCommandController } from "@stigmer/protos/ai/stigmer/iam/grant/v1/command_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { SERVER_ORGANIZATION_ROLES_KEY } from "../../domain/grant/constants.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import {
  SINGLE_ORGANIZATION_SLUG,
  SINGLE_ORG_KEY,
} from "../../domain/organization/limit.js";
import { organizationNameKey } from "../../domain/organization/names.js";
import {
  resetOperatorIdentityForTests,
  setOperatorIdentity,
} from "../../pipeline/steps/defaults.js";
import type { Store } from "../../store/interface.js";
import type { ServerExtension } from "../registry.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "./composed-support.js";

const FIRST = "fake|first";
const SECOND = "fake|second";
const firstId = (): string => accountIdFor(FIRST);
const secondId = (): string => accountIdFor(SECOND);

/** An organization id as the server mints it. */
const MINTED_ORGANIZATION_ID = /^org_[0-9a-z]{26}$/;

/**
 * The organization the store records as the server's: its minted id, read
 * from SINGLE_ORG_KEY, and the slug of the row that id names.
 */
async function serverOrganization(
  store: Store,
): Promise<{ id: string; slug: string }> {
  const id = await store.bootstrapState.get(SINGLE_ORG_KEY);
  expect(id).toMatch(MINTED_ORGANIZATION_ID);
  const row = await store.getResource(
    ApiResourceKind.organization,
    id,
    OrganizationSchema,
  );
  return { id, slug: row.metadata?.slug ?? "" };
}

/** `principal:relation@organization|by:actor` per row, sorted: the whole role state of the store. */
async function rolesIn(store: Store): Promise<ReadonlyArray<string>> {
  const rows = await store.listResources(ApiResourceKind.grant);
  return rows
    .map((bytes) => fromBinary(GrantSchema, bytes))
    .map(
      (row) =>
        `${row.spec?.principal?.id}:${row.spec?.relation}@${row.spec?.resource?.id}` +
        `|by:${row.status?.audit?.specAudit?.createdBy?.id ?? ""}`,
    )
    .sort();
}

describe("roles on the server's organization (composed server, OIDC with no unit Authorizer, three boots over one directory)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;

  const signIn: ServerExtension = {
    name: "fake-oidc-only",
    requireAuthentication: true,
    identityVerifiers: [fakeVerifier],
  };
  const oneOrganization: ServerExtension = { ...signIn, orgLimit: 1 };

  async function boot(unit: ServerExtension): Promise<void> {
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  }

  const asFirst = () => transportFor(port, fakeJwt(FIRST, "first@example.com"));
  const asSecond = () =>
    transportFor(port, fakeJwt(SECOND, "second@example.com"));
  /** The id boot 2 minted for `stigmer`; boot 3 names the organization by it. */
  let stigmerId = "";

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "server-organization-roles-"));
    await boot(signIn);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("boot 1: two people sign in to a server that holds any number, and nobody makes an organization", async () => {
    await createClient(
      IdentityAccountCommandController,
      asFirst(),
    ).provisionMyAccount({});
    // Apart in time, so creation order is sign-in order whatever the ids.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createClient(
      IdentityAccountCommandController,
      asSecond(),
    ).provisionMyAccount({});

    expect(
      await server.store.listResources(ApiResourceKind.organization),
    ).toHaveLength(0);
    expect(await rolesIn(server.store)).toEqual([]);
    await server.shutdown();
  });

  it("boot 2: as a one-organization server it makes `stigmer`, and the people it held get their roles on it, as their own", async () => {
    await boot(oneOrganization);

    const made = await serverOrganization(server.store);
    expect(made.slug).toBe(SINGLE_ORGANIZATION_SLUG);
    stigmerId = made.id;
    expect(await rolesIn(server.store)).toEqual(
      [
        `${firstId()}:owner@${stigmerId}|by:${firstId()}`,
        `${secondId()}:member@${stigmerId}|by:${secondId()}`,
      ].sort(),
    );
    expect(
      await server.store.bootstrapState.get(SERVER_ORGANIZATION_ROLES_KEY),
    ).not.toBe("");
    for (const as of [asFirst, asSecond]) {
      const found = await createClient(
        OrganizationQueryController,
        as(),
      ).listMine({});
      expect(found.entries.map((entry) => entry.metadata?.id)).toEqual([
        stigmerId,
      ]);
    }
  });

  it("boot 3: a role removed after the pass stays removed — a reboot hands nothing back", async () => {
    await createClient(GrantCommandController, asFirst()).revokeOrgAccess({
      identityAccountId: secondId(),
      org: "stigmer",
    });
    await server.shutdown();

    await boot(oneOrganization);

    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe(
      stigmerId,
    );
    expect(await rolesIn(server.store)).toEqual([
      `${firstId()}:owner@${stigmerId}|by:${firstId()}`,
    ]);
    const found = await createClient(
      OrganizationQueryController,
      asSecond(),
    ).listMine({});
    expect(found.entries).toEqual([]);
  });
});

describe("a laptop that turns sign-in on (composed server, trusted-local then OIDC with no operator email, over one directory)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;

  const laptop: ServerExtension = { name: "laptop", orgLimit: 1 };
  const signedIn: ServerExtension = {
    name: "fake-oidc-only",
    requireAuthentication: true,
    identityVerifiers: [fakeVerifier],
    orgLimit: 1,
  };

  async function boot(unit: ServerExtension): Promise<void> {
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "laptop-to-sign-in-"));
    await boot(laptop);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the first person to sign in owns the laptop's organization, and the next is a member", async () => {
    const laptopOrganization = await serverOrganization(server.store);
    expect(laptopOrganization.slug).toBe(SINGLE_ORGANIZATION_SLUG);
    const laptopRows = await rolesIn(server.store);
    expect(laptopRows).toHaveLength(1);
    expect(laptopRows[0]).toContain(`:owner@${laptopOrganization.id}|by:`);
    await server.shutdown();

    await boot(signedIn);
    await createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(FIRST, "first@example.com")),
    ).provisionMyAccount({});
    await createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(SECOND, "second@example.com")),
    ).provisionMyAccount({});

    const roles = await rolesIn(server.store);
    expect(roles).toContain(
      `${firstId()}:owner@${laptopOrganization.id}|by:${firstId()}`,
    );
    expect(roles).toContain(
      `${secondId()}:member@${laptopOrganization.id}|by:${secondId()}`,
    );
    const found = await createClient(
      OrganizationQueryController,
      transportFor(port, fakeJwt(FIRST, "first@example.com")),
    ).listMine({});
    expect(found.entries.map((entry) => entry.metadata?.id)).toEqual([
      laptopOrganization.id,
    ]);
  });
});

describe("an older release's laptop organization when sign-in is turned on (composed server, trusted-local with any number, then OIDC with one and no operator email)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;

  const signedIn: ServerExtension = {
    name: "fake-oidc-only",
    requireAuthentication: true,
    identityVerifiers: [fakeVerifier],
    orgLimit: 1,
  };

  async function boot(
    extensions: ReadonlyArray<ServerExtension>,
  ): Promise<void> {
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions,
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "older-laptop-to-sign-in-"));
    await boot([]);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the first person to sign in owns `acme`, and the next is a member", async () => {
    const acme = await createClient(
      OrganizationCommandController,
      transportFor(port),
    ).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: "acme", slug: "acme", org: "" },
      spec: { description: "made on the laptop by an older release" },
    });
    await server.shutdown();

    const acmeId = acme.metadata?.id ?? "";
    expect(acmeId).toMatch(MINTED_ORGANIZATION_ID);

    await boot([signedIn]);
    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe(acmeId);
    await createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(FIRST, "first@example.com")),
    ).provisionMyAccount({});
    await createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(SECOND, "second@example.com")),
    ).provisionMyAccount({});

    const roles = await rolesIn(server.store);
    expect(roles).toContain(`${firstId()}:owner@${acmeId}|by:${firstId()}`);
    expect(roles).toContain(`${secondId()}:member@${acmeId}|by:${secondId()}`);
  });
});

describe("a sign-in install upgraded with its one organization (composed server, OIDC with any number, then OIDC with one)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;

  const anyNumber: ServerExtension = {
    name: "fake-oidc-only",
    requireAuthentication: true,
    identityVerifiers: [fakeVerifier],
  };

  async function boot(unit: ServerExtension): Promise<void> {
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  }

  const asFirst = () => transportFor(port, fakeJwt(FIRST, "first@example.com"));

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "upgraded-sign-in-"));
    await boot(anyNumber);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a member removed before the upgrade is not handed a role back by it", async () => {
    await createClient(
      IdentityAccountCommandController,
      asFirst(),
    ).provisionMyAccount({});
    const acme = await createClient(
      OrganizationCommandController,
      asFirst(),
    ).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: "acme", slug: "acme", org: "" },
      spec: { description: "founded under sign-in" },
    });
    const acmeId = acme.metadata?.id ?? "";
    expect(acmeId).toMatch(MINTED_ORGANIZATION_ID);
    await createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(SECOND, "second@example.com")),
    ).provisionMyAccount({});
    await createClient(GrantCommandController, asFirst()).revokeOrgAccess({
      identityAccountId: secondId(),
      org: "acme",
    });
    expect(await rolesIn(server.store)).toEqual([
      `${firstId()}:owner@${acmeId}|by:${firstId()}`,
    ]);
    await server.shutdown();

    await boot({ ...anyNumber, orgLimit: 1 });

    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe(acmeId);
    expect(await rolesIn(server.store)).toEqual([
      `${firstId()}:owner@${acmeId}|by:${firstId()}`,
    ]);
  });
});

describe("a sign-in install with an operator email, upgraded with its one organization (composed server)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  const OPERATOR = "fake|operator";
  const operatorId = (): string => accountIdFor(OPERATOR);

  const anyNumber: ServerExtension = {
    name: "fake-oidc-only",
    requireAuthentication: true,
    identityVerifiers: [fakeVerifier],
  };

  async function boot(unit: ServerExtension): Promise<void> {
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  }

  beforeAll(async () => {
    setOperatorIdentity("operator@example.com", "Operator");
    dir = mkdtempSync(path.join(tmpdir(), "upgraded-operator-"));
    await boot(anyNumber);
  });

  afterAll(async () => {
    await server.shutdown();
    resetOperatorIdentityForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("an operator who signed in before the upgrade keeps admin; nothing is changed at boot", async () => {
    const asFounder = () =>
      transportFor(port, fakeJwt(FIRST, "first@example.com"));
    await createClient(
      IdentityAccountCommandController,
      asFounder(),
    ).provisionMyAccount({});
    const acme = await createClient(
      OrganizationCommandController,
      asFounder(),
    ).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: "acme", slug: "acme", org: "" },
      spec: { description: "founded under sign-in" },
    });
    const acmeId = acme.metadata?.id ?? "";
    expect(acmeId).toMatch(MINTED_ORGANIZATION_ID);
    await createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(OPERATOR, "operator@example.com")),
    ).provisionMyAccount({});
    const before = await rolesIn(server.store);
    expect(before).toEqual(
      [
        `${firstId()}:owner@${acmeId}|by:${firstId()}`,
        `${operatorId()}:admin@${acmeId}|by:${operatorId()}`,
      ].sort(),
    );
    await server.shutdown();

    await boot({ ...anyNumber, orgLimit: 1 });

    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe(acmeId);
    expect(await rolesIn(server.store)).toEqual(before);
  });
});

describe("a server that cannot make its organization (composed server, OIDC; its slug held by an interrupted create)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;

  const anyNumber: ServerExtension = {
    name: "fake-oidc-only",
    requireAuthentication: true,
    identityVerifiers: [fakeVerifier],
  };
  const oneOrganization: ServerExtension = { ...anyNumber, orgLimit: 1 };

  async function boot(unit: ServerExtension): Promise<void> {
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  }

  const asFirst = () => transportFor(port, fakeJwt(FIRST, "first@example.com"));
  const organizationNamed = (slug: string) => ({
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug, org: "" },
    spec: { description: slug },
  });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "retired-slug-"));
    await boot(anyNumber);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("an organization made in the console later owes nobody a role: a member removed there stays removed", async () => {
    // Before the upgrade: a create of `stigmer` claimed the slug and died
    // before its row was stored. A deleted organization's slug is released,
    // so this young claim is the one way left for the slug to be taken with
    // no organization behind it; the claim is seconds old, too young to
    // count as abandoned, so the boot's create is refused as a duplicate.
    await createClient(
      IdentityAccountCommandController,
      asFirst(),
    ).provisionMyAccount({});
    const interrupted = await server.store.resourceNames.claim(
      organizationNameKey(SINGLE_ORGANIZATION_SLUG),
      "org_01hzzzzzzzzzzzzzzzzzzzzzzz",
      new Date().toISOString(),
    );
    expect(interrupted.claimed).toBe(true);
    await server.shutdown();

    // The one-organization server cannot make `stigmer`, and boots with none.
    await boot(oneOrganization);
    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe("");
    expect(
      await server.store.listResources(ApiResourceKind.organization),
    ).toHaveLength(0);
    const acme = await createClient(
      OrganizationCommandController,
      asFirst(),
    ).create(organizationNamed("acme"));
    const acmeId = acme.metadata?.id ?? "";
    expect(acmeId).toMatch(MINTED_ORGANIZATION_ID);
    await createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(SECOND, "second@example.com")),
    ).provisionMyAccount({});
    await createClient(GrantCommandController, asFirst()).revokeOrgAccess({
      identityAccountId: secondId(),
      org: "acme",
    });
    await server.shutdown();

    await boot(oneOrganization);

    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe(acmeId);
    expect(await rolesIn(server.store)).toEqual([
      `${firstId()}:owner@${acmeId}|by:${firstId()}`,
    ]);
  });
});
