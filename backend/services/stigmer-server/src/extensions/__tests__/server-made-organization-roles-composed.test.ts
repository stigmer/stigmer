/**
 * Pins, end to end, the roles on the organization a one-organization server
 * makes itself under sign-in, when the store it boots on already holds people
 * (domain/iampolicy/membership.ts `ensureRolesOnServerMadeOrganization`).
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
 * organization (domain/iampolicy/membership.ts).
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
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { SERVER_MADE_ORGANIZATION_ROLES_KEY } from "../../domain/iampolicy/constants.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { SINGLE_ORG_KEY } from "../../domain/organization/limit.js";
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

/** `principal:relation@organization|by:actor` per row, sorted: the whole role state of the store. */
async function rolesIn(store: Store): Promise<ReadonlyArray<string>> {
  const rows = await store.listResources(ApiResourceKind.iam_policy);
  return rows
    .map((bytes) => fromBinary(IamPolicySchema, bytes))
    .map(
      (row) =>
        `${row.spec?.principal?.id}:${row.spec?.relation}@${row.spec?.resource?.id}` +
        `|by:${row.status?.audit?.specAudit?.createdBy?.id ?? ""}`,
    )
    .sort();
}

describe("roles on the server-made organization (composed server, OIDC with no unit Authorizer, three boots over one directory)", () => {
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

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "server-made-roles-"));
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

    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe(
      "stigmer",
    );
    expect(await rolesIn(server.store)).toEqual(
      [
        `${firstId()}:owner@stigmer|by:${firstId()}`,
        `${secondId()}:member@stigmer|by:${secondId()}`,
      ].sort(),
    );
    expect(
      await server.store.bootstrapState.get(SERVER_MADE_ORGANIZATION_ROLES_KEY),
    ).not.toBe("");
    for (const as of [asFirst, asSecond]) {
      const found = await createClient(
        OrganizationQueryController,
        as(),
      ).findMyOrganizations({});
      expect(found.entries.map((entry) => entry.metadata?.id)).toEqual([
        "stigmer",
      ]);
    }
  });

  it("boot 3: a role removed after the pass stays removed — a reboot hands nothing back", async () => {
    await createClient(IamPolicyCommandController, asFirst()).revokeOrgAccess({
      identityAccountId: secondId(),
      org: "stigmer",
    });
    await server.shutdown();

    await boot(oneOrganization);

    expect(await rolesIn(server.store)).toEqual([
      `${firstId()}:owner@stigmer|by:${firstId()}`,
    ]);
    const found = await createClient(
      OrganizationQueryController,
      asSecond(),
    ).findMyOrganizations({});
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
    const [laptopRow] = await rolesIn(server.store);
    expect(laptopRow).toMatch(/:owner@stigmer\|by:/);
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
    expect(roles).toContain(`${firstId()}:owner@stigmer|by:${firstId()}`);
    expect(roles).toContain(`${secondId()}:member@stigmer|by:${secondId()}`);
    const found = await createClient(
      OrganizationQueryController,
      transportFor(port, fakeJwt(FIRST, "first@example.com")),
    ).findMyOrganizations({});
    expect(found.entries.map((entry) => entry.metadata?.id)).toEqual([
      "stigmer",
    ]);
  });
});
