// Pins the system org's "ensure" over a real Connect backend: an org the
// identity already sees is `present` with no create; an absent one is
// created as the Organization as code (slug, name, label, self-managed) and
// reported `created`; a create that loses the race to another launcher
// (ALREADY_EXISTS) is `present`, not an error; any other refusal propagates
// with the server's sentence.

import {
  createServer as createHttp2Server,
  type Http2Server,
  type ServerHttp2Session,
} from "node:http2";
import type { AddressInfo } from "node:net";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  type Organization,
  OrganizationSchema,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { ManagementMode } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/enum_pb";
import { OrganizationsSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { createNodeClient, normalizeEndpoint } from "@stigmer/sdk/node";
import type { Stigmer } from "@stigmer/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_ORG, SYSTEM_ORG_LABEL, ensureSystemOrg } from "./system-org.js";

let backend: Http2Server;
let stigmer: Stigmer;
const openSessions = new Set<ServerHttp2Session>();

/** The orgs the backend holds, by slug. */
let held: Map<string, Organization>;
let creates: Organization[];
/** What `create` answers with instead of creating, when set. */
let refuseCreate: ConnectError | undefined;

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(OrganizationQueryController, {
      findMyOrganizations: () =>
        create(OrganizationsSchema, { entries: [...held.values()] }),
    });
    router.service(OrganizationCommandController, {
      create: (org) => {
        creates.push(org);
        if (refuseCreate !== undefined) throw refuseCreate;
        const slug = org.metadata?.slug ?? "";
        const row = create(OrganizationSchema, org);
        if (row.metadata !== undefined) row.metadata.id = `org_${slug}`;
        held.set(slug, row);
        return row;
      },
    });
  };
  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;
  stigmer = createNodeClient({
    baseUrl: normalizeEndpoint(`127.0.0.1:${port}`),
  });
});

afterAll(async () => {
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

beforeEach(() => {
  held = new Map();
  creates = [];
  refuseCreate = undefined;
});

describe("ensureSystemOrg", () => {
  it("is present, with no create, when the identity already sees it", async () => {
    held.set(
      SYSTEM_ORG,
      create(OrganizationSchema, { metadata: { slug: SYSTEM_ORG } }),
    );
    expect(await ensureSystemOrg(stigmer)).toBe("present");
    expect(creates).toHaveLength(0);
  });

  it("creates the Organization as code when absent", async () => {
    held.set(
      "acme",
      create(OrganizationSchema, { metadata: { slug: "acme" } }),
    );
    expect(await ensureSystemOrg(stigmer)).toBe("created");
    expect(creates).toHaveLength(1);
    const sent = creates[0]!;
    expect(sent.metadata?.slug).toBe(SYSTEM_ORG);
    expect(sent.metadata?.org).toBe(SYSTEM_ORG);
    expect(sent.metadata?.name).toBe("Stigmer");
    expect(sent.metadata?.labels).toEqual({ [SYSTEM_ORG_LABEL]: "true" });
    expect(sent.spec?.managementMode).toBe(ManagementMode.self_managed);
    expect(sent.spec?.description).not.toBe("");
  });

  it("treats a create lost to another launcher as present", async () => {
    refuseCreate = new ConnectError(
      `organization '${SYSTEM_ORG}' already exists`,
      Code.AlreadyExists,
    );
    expect(await ensureSystemOrg(stigmer)).toBe("present");
  });

  it("propagates any other refusal with the server's sentence", async () => {
    refuseCreate = new ConnectError(
      "reserved labels are platform-managed",
      Code.PermissionDenied,
    );
    await expect(ensureSystemOrg(stigmer)).rejects.toThrow(
      /reserved labels are platform-managed/,
    );
  });
});
