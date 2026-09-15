/**
 * Pins the built-in posture's boot reconciliation END TO END: a database
 * whose people were provisioned before organization roles existed (the
 * 3.15.x self-host with OIDC on) is given, at its first boot under the
 * enforcing posture, exactly the rows those people's first sign-ins would
 * have written — once, and never again.
 *
 * Three boots over ONE data directory, the shape proven by behaviour over
 * real boots:
 *   1. A fresh server: the founder provisions and founds an organization
 *      (the owner row, 2b's lifecycle), the member provisions afterwards
 *      (the member row, the hook). Then the 3.15.x shape is made
 *      literally on the store the server used: every role row deleted and
 *      the reconciliation marker deleted. Accounts, organization and
 *      blueprint stay.
 *   2. The same directory boots again: the rows are back — the founder
 *      `owner`, the member `member` — each written AS the account it names
 *      (the audit actor), `findMyOrganizations` answers the organization
 *      to both, and the marker is set.
 *   3. The founder revokes everyone, the member first and then themself,
 *      and the directory boots once more: NO row returns. The marker, not
 *      "zero rows", is what makes the reconciliation one-shot — a revoked
 *      founder is not handed the organization back by a reboot.
 *
 * The unit vouches for unsigned JWT-shaped tokens and declares the
 * require-authentication posture with no Authorizer (composed-support.ts;
 * the open-source OIDC self-host's shape, the same recipe
 * built-in-authorization-composed.test.ts boots). The per-arm proofs of
 * the reconciliation (order, the machine account, the fault, the half-run
 * database) are domain/iampolicy/__tests__/membership.test.ts; this file
 * is the upgrade's definition of done at the wire.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fromBinary } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { ROLES_RECONCILED_KEY } from "../../domain/iampolicy/constants.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import type { Store } from "../../store/interface.js";
import type { ServerExtension } from "../registry.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "./composed-support.js";

const FOUNDER = "fake|founder";
const MEMBER = "fake|member";
const ORG = "reconciled-org";

/** `relation@organization` per principal, sorted — the whole role state of the store in one readable shape. */
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

describe("role reconciliation (composed server, OIDC with no unit Authorizer, three boots over one directory)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;

  const unit: ServerExtension = {
    name: "fake-oidc-only",
    requireAuthentication: true,
    identityVerifiers: [fakeVerifier],
  };

  async function boot(): Promise<void> {
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  }

  const asFounder = () =>
    transportFor(port, fakeJwt(FOUNDER, "founder@example.com"));
  const asMember = () =>
    transportFor(port, fakeJwt(MEMBER, "member@example.com"));

  const founderId = accountIdFor(FOUNDER);
  const memberId = accountIdFor(MEMBER);
  const expectedRows = [
    `${founderId}:owner@${ORG}|by:${founderId}`,
    `${memberId}:member@${ORG}|by:${memberId}`,
  ];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "role-reconciliation-"));
    await boot();
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("boot 1: the fresh server writes the rows at sign-in, and the marker is set from the first boot", async () => {
    await createClient(
      IdentityAccountCommandController,
      asFounder(),
    ).provisionMyAccount({});
    await createClient(OrganizationCommandController, asFounder()).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: ORG, slug: ORG, org: "" },
      spec: { description: ORG },
    });
    await createClient(AgentCommandController, asFounder()).create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: {
        name: "shared",
        org: ORG,
        visibility: ApiResourceVisibility.visibility_org,
      },
      spec: { instructions: "a conformant instruction body" },
    });
    await createClient(
      IdentityAccountCommandController,
      asMember(),
    ).provisionMyAccount({});

    expect(await rolesIn(server.store)).toEqual(expectedRows);
    expect(
      await server.store.bootstrapState.get(ROLES_RECONCILED_KEY),
    ).not.toBe("");
  });

  it("boot 2: over the 3.15.x shape — accounts and no rows, no marker — the rows come back as each person's own, and the marker is set", async () => {
    // The 3.15.x database, made literally on the store the server used.
    await server.store.deleteResourcesByKind(ApiResourceKind.iam_policy);
    await server.store.bootstrapState.delete(ROLES_RECONCILED_KEY);
    expect(await rolesIn(server.store)).toEqual([]);
    await server.shutdown();

    await boot();

    expect(await rolesIn(server.store)).toEqual(expectedRows);
    expect(
      await server.store.bootstrapState.get(ROLES_RECONCILED_KEY),
    ).not.toBe("");
    const founderOrgs = await createClient(
      OrganizationQueryController,
      asFounder(),
    ).findMyOrganizations({});
    const memberOrgs = await createClient(
      OrganizationQueryController,
      asMember(),
    ).findMyOrganizations({});
    expect(founderOrgs.entries.map((entry) => entry.metadata?.id)).toEqual([
      ORG,
    ]);
    expect(memberOrgs.entries.map((entry) => entry.metadata?.id)).toEqual([
      ORG,
    ]);
  });

  it("boot 3: every role revoked after the marker stays revoked — a reboot hands nothing back", async () => {
    const policies = createClient(IamPolicyCommandController, asFounder());
    await policies.revokeOrgAccess({
      identityAccountId: memberId,
      organizationId: ORG,
    });
    await policies.revokeOrgAccess({
      identityAccountId: founderId,
      organizationId: ORG,
    });
    expect(await rolesIn(server.store)).toEqual([]);
    await server.shutdown();

    await boot();

    expect(await rolesIn(server.store)).toEqual([]);
    const founderOrgs = await createClient(
      OrganizationQueryController,
      asFounder(),
    ).findMyOrganizations({});
    expect(founderOrgs.entries).toEqual([]);
  });
});
