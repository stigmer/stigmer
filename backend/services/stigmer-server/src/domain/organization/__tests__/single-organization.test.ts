/**
 * Pins the open-source edition's one organization end to end, on a server
 * composed exactly as the shipped entry composes it (editions/open-source.ts)
 * in the trusted-local posture, over the wire:
 *
 *   - the first start makes `stigmer` under a minted id, owned by the
 *     operator through the role lifecycle, and records that id under
 *     SINGLE_ORG_KEY;
 *   - getServerInfo answers `single_org: true`;
 *   - a request that names no organization acts in it, and one that names an
 *     organization that does not exist is still refused by name;
 *   - a second organization is refused with ORGANIZATION_LIMIT_REACHED and
 *     leaves no row and no slug claim; a duplicate of the one is a duplicate;
 *   - deleting the one is refused with ORGANIZATION_IS_SINGLE before any
 *     write, so its slug is not retired;
 *   - a second start on the same store makes nothing and fills the same one.
 *
 * On a store holding several organizations (one a broader composition
 * wrote):
 * nothing is filled, `single_org` is false, no organization can be added,
 * and the organizations can be deleted down to one, which is then refused.
 *
 * And, on a composition that declares a limit above one, the count alone:
 * creates up to the limit pass, the next is refused, and nothing is made at
 * boot or filled.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { openSourceEdition } from "../../../editions/open-source.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import {
  resetOperatorIdentityForTests,
  setOperatorIdentity,
} from "../../../pipeline/steps/defaults.js";
import { fakeGrantStore } from "../../grant/__tests__/support.js";
import {
  ORGANIZATION_IS_SINGLE,
  ORGANIZATION_LIMIT_REACHED,
  SINGLE_ORG_KEY,
} from "../limit.js";
import { organizationNameKey } from "../names.js";

const OPERATOR_EMAIL = "operator@example.com";

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

function organizationInput(slug: string) {
  return {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug },
    spec: { description: "created by the single organization test" },
  };
}

function agentInput(name: string, org = "") {
  return {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: { name, org },
    spec: { instructions: "An agent the single organization test creates." },
  };
}

function compose(
  dir: string,
  extensions: ReadonlyArray<ServerExtension>,
): Promise<ComposedServer> {
  return composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      STIGMER_OPERATOR_EMAIL: OPERATOR_EMAIL,
    }),
    logger: createLogger({ level: "error", pretty: false, write: () => {} }),
    extensions,
    portOverride: 0,
    host: "127.0.0.1",
  });
}

function clientsAt(port: number) {
  const transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  return {
    organizations: createClient(OrganizationCommandController, transport),
    organizationQuery: createClient(OrganizationQueryController, transport),
    agents: createClient(AgentCommandController, transport),
    platform: createClient(PlatformQueryController, transport),
  };
}

describe("the open-source edition's one organization (composed as main.ts composes it, trusted-local)", () => {
  const grants = fakeGrantStore();
  const policyUnit: ServerExtension = {
    name: "fake-grants",
    drivers: { grantStore: grants },
  };

  let dir: string;
  let server: ComposedServer;
  let organizations: Client<typeof OrganizationCommandController>;
  let organizationQuery: Client<typeof OrganizationQueryController>;
  let agents: Client<typeof AgentCommandController>;
  let platform: Client<typeof PlatformQueryController>;
  // The id the first start minted for `stigmer`, read once the server
  // listens; every stored value and record names the organization by it.
  let stigmerId: string;

  function ownersOf(org: string): ReadonlyArray<string> {
    return [...grants.rows.values()]
      .filter(
        (grant) =>
          grant.spec?.resource?.kind === "organization" &&
          grant.spec.resource.id === org &&
          grant.spec.relation === "owner",
      )
      .map((grant) => grant.spec?.principal?.id ?? "");
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "single-organization-test-"));
    setOperatorIdentity(OPERATOR_EMAIL, "The Operator");
    server = await compose(dir, [openSourceEdition, policyUnit]);
    ({ organizations, organizationQuery, agents, platform } = clientsAt(
      await server.start(),
    ));
    stigmerId =
      (await organizationQuery.listMine({})).entries[0]?.metadata
        ?.id ?? "";
  });

  afterAll(async () => {
    await server.shutdown();
    resetOperatorIdentityForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the first start makes `stigmer`, owned by the operator, and records it", async () => {
    const mine = await organizationQuery.listMine({});
    expect(mine.entries.map((org) => org.metadata?.slug)).toEqual(["stigmer"]);
    expect(stigmerId).toMatch(/^org_[0-9a-z]{26}$/);
    const made = mine.entries[0];
    expect(made?.metadata?.id).toBe(stigmerId);
    expect(made?.metadata?.org).toBe("");
    expect(ownersOf(stigmerId)).toHaveLength(1);
    expect(made?.status?.audit?.specAudit?.createdBy?.id).toBe(
      ownersOf(stigmerId)[0],
    );
    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe(
      stigmerId,
    );
  });

  it("getServerInfo answers single_org", async () => {
    expect((await platform.getServerInfo({})).singleOrg).toBe(true);
  });

  it("a request that names no organization acts in the one; an unknown one is refused by name", async () => {
    const agent = await agents.create(agentInput("Helper"));
    expect(agent.metadata?.org).toBe(stigmerId);

    const refusal = await grpcError(() =>
      agents.create(agentInput("Elsewhere", "no-such-org")),
    );
    expect(refusal.code).toBe(Code.NotFound);
    expect(refusal.rawMessage).toContain("no-such-org");
  });

  it("a second organization is refused before anything is written; a duplicate of the one is a duplicate", async () => {
    const refusal = await grpcError(() =>
      organizations.create(organizationInput("second")),
    );
    expect(refusal.code).toBe(Code.FailedPrecondition);
    expect(refusal.rawMessage).toBe(
      "this server holds 1 organization, its limit",
    );
    expect(refusal.findDetails(ErrorInfoSchema)).toMatchObject([
      { reason: ORGANIZATION_LIMIT_REACHED, metadata: { limit: "1" } },
    ]);
    expect(
      await server.store.listResources(ApiResourceKind.organization),
    ).toHaveLength(1);
    expect(
      await server.store.resourceNames.resolve(
        organizationNameKey("second"),
        new Date().toISOString(),
      ),
    ).toBeUndefined();

    const duplicate = await grpcError(() =>
      organizations.create(organizationInput("stigmer")),
    );
    expect(duplicate.code).toBe(Code.AlreadyExists);
  });

  it("deleting the one is refused before any write: the organization stays and keeps its name", async () => {
    // Named by slug: the serving chain resolves it to the id the refusal
    // carries.
    const refusal = await grpcError(() =>
      organizations.delete({ value: "stigmer" }),
    );
    expect(refusal.code).toBe(Code.FailedPrecondition);
    expect(refusal.rawMessage).toBe(
      "this server's only organization cannot be deleted",
    );
    expect(refusal.findDetails(ErrorInfoSchema)).toMatchObject([
      { reason: ORGANIZATION_IS_SINGLE, metadata: { org: stigmerId } },
    ]);
    expect(
      (await organizationQuery.listMine({})).entries,
    ).toHaveLength(1);
    expect(
      (
        await server.store.resourceNames.resolve(
          organizationNameKey("stigmer"),
          new Date().toISOString(),
        )
      )?.state,
    ).toBe("current");
    expect(ownersOf(stigmerId)).toHaveLength(1);
  });

  it("deleting an organization that does not exist is still NotFound", async () => {
    const refusal = await grpcError(() =>
      organizations.delete({ value: "no-such-org" }),
    );
    expect(refusal.code).toBe(Code.NotFound);
  });

  it("a second start on the same store makes nothing and fills the same one", async () => {
    await server.shutdown();
    server = await compose(dir, [openSourceEdition, policyUnit]);
    ({ organizations, organizationQuery, agents, platform } = clientsAt(
      await server.start(),
    ));

    expect(
      (await organizationQuery.listMine({})).entries.map(
        (org) => org.metadata?.id,
      ),
    ).toEqual([stigmerId]);
    expect((await agents.create(agentInput("Again"))).metadata?.org).toBe(
      stigmerId,
    );
    expect((await platform.getServerInfo({})).singleOrg).toBe(true);
  });
});

describe("a store holding several organizations", () => {
  let dir: string;
  let server: ComposedServer;
  let organizations: Client<typeof OrganizationCommandController>;
  let agents: Client<typeof AgentCommandController>;
  let platform: Client<typeof PlatformQueryController>;

  beforeAll(async () => {
    dir = mkdtempSync(
      path.join(tmpdir(), "single-organization-several-test-"),
    );
    setOperatorIdentity(OPERATOR_EMAIL, "The Operator");
    server = await compose(dir, [openSourceEdition]);
    for (const slug of ["acme", "globex"]) {
      await server.store.saveResource(
        ApiResourceKind.organization,
        slug,
        OrganizationSchema,
        create(OrganizationSchema, {
          apiVersion: "tenancy.stigmer.ai/v1",
          kind: "Organization",
          metadata: { id: slug, slug, name: slug },
        }),
      );
    }
    ({ organizations, agents, platform } = clientsAt(await server.start()));
  });

  afterAll(async () => {
    await server.shutdown();
    resetOperatorIdentityForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("fills nothing, says so, makes nothing and admits no new organization", async () => {
    expect((await platform.getServerInfo({})).singleOrg).toBe(false);
    expect(
      await server.store.listResources(ApiResourceKind.organization),
    ).toHaveLength(2);
    expect((await agents.create(agentInput("Unfilled"))).metadata?.org).toBe(
      "",
    );
    const refusal = await grpcError(() =>
      organizations.create(organizationInput("third")),
    );
    expect(refusal.findDetails(ErrorInfoSchema)).toMatchObject([
      { reason: ORGANIZATION_LIMIT_REACHED },
    ]);
  });

  it("deletes down to one organization, then refuses to delete it", async () => {
    await organizations.delete({ value: "globex" });
    const refusal = await grpcError(() =>
      organizations.delete({ value: "acme" }),
    );
    expect(refusal.code).toBe(Code.FailedPrecondition);
    expect(refusal.findDetails(ErrorInfoSchema)).toMatchObject([
      { reason: ORGANIZATION_IS_SINGLE, metadata: { org: "acme" } },
    ]);
    expect(
      await server.store.listResources(ApiResourceKind.organization),
    ).toHaveLength(1);
  });
});

describe("a declared limit above one (the count alone)", () => {
  const limitOfTwo: ServerExtension = { name: "limit-of-two", orgLimit: 2 };

  let dir: string;
  let server: ComposedServer;
  let organizations: Client<typeof OrganizationCommandController>;
  let agents: Client<typeof AgentCommandController>;
  let platform: Client<typeof PlatformQueryController>;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "organization-limit-test-"));
    setOperatorIdentity(OPERATOR_EMAIL, "The Operator");
    server = await compose(dir, [limitOfTwo]);
    ({ organizations, agents, platform } = clientsAt(await server.start()));
  });

  afterAll(async () => {
    await server.shutdown();
    resetOperatorIdentityForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("makes nothing at boot, fills nothing, and answers single_org false", async () => {
    expect(
      await server.store.listResources(ApiResourceKind.organization),
    ).toHaveLength(0);
    expect((await platform.getServerInfo({})).singleOrg).toBe(false);
    // Trusted-local admits an empty org as a platform-scoped write; the point
    // is that nothing filled one in.
    const agent = await agents.create(agentInput("Nowhere"));
    expect(agent.metadata?.org).toBe("");
  });

  it("admits creates up to the limit, refuses the next, and lets one be deleted", async () => {
    await organizations.create(organizationInput("first"));
    await organizations.create(organizationInput("second"));

    const refusal = await grpcError(() =>
      organizations.create(organizationInput("third")),
    );
    expect(refusal.code).toBe(Code.FailedPrecondition);
    expect(refusal.rawMessage).toBe(
      "this server holds 2 organizations, its limit",
    );
    expect(refusal.findDetails(ErrorInfoSchema)).toMatchObject([
      { reason: ORGANIZATION_LIMIT_REACHED, metadata: { limit: "2" } },
    ]);

    await organizations.delete({ value: "second" });
    await organizations.create(organizationInput("third"));
  });
});
