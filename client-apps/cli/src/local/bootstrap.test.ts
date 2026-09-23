// Pins the bootstrap's one act over a real Connect backend: an org the
// identity already sees is `present` with no create; an absent one is created
// as the Organization as code (slug, name, self-managed) with NO label, since
// a reserved `stigmer.ai/` label is refused by a self-hosted server with
// authentication on (stigmer/stigmer#1192); a create that loses the race to
// another launcher (ALREADY_EXISTS) is `present`, not an error; any other
// refusal propagates with the server's sentence. And the local shape `up`
// runs: it announces a created org, stays quiet on a present one, and turns
// any failure into one warning naming the retry, never a throw.

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
import type { BackendClient } from "../client/index.js";
import { DEFAULT_LOCAL_ORG } from "../config/resolve.js";
import { bootstrapBackend, bootstrapLocalBackend } from "./bootstrap.js";

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

describe("bootstrapBackend", () => {
  it("is present, with no create, when the identity already sees the org", async () => {
    held.set(
      DEFAULT_LOCAL_ORG,
      create(OrganizationSchema, { metadata: { slug: DEFAULT_LOCAL_ORG } }),
    );
    expect(await bootstrapBackend(stigmer)).toBe("present");
    expect(creates).toHaveLength(0);
  });

  it("creates the Organization as code, with no label, when absent", async () => {
    held.set("acme", create(OrganizationSchema, { metadata: { slug: "acme" } }));
    expect(await bootstrapBackend(stigmer)).toBe("created");
    expect(creates).toHaveLength(1);
    const sent = creates[0]!;
    expect(sent.metadata?.slug).toBe(DEFAULT_LOCAL_ORG);
    expect(sent.metadata?.org).toBe(DEFAULT_LOCAL_ORG);
    expect(sent.metadata?.name).toBe("Stigmer");
    expect(sent.metadata?.labels).toEqual({});
    expect(sent.spec?.managementMode).toBe(ManagementMode.self_managed);
    expect(sent.spec?.description).not.toBe("");
  });

  it("treats a create lost to another launcher as present", async () => {
    refuseCreate = new ConnectError(
      `organization '${DEFAULT_LOCAL_ORG}' already exists`,
      Code.AlreadyExists,
    );
    expect(await bootstrapBackend(stigmer)).toBe("present");
  });

  it("propagates any other refusal with the server's sentence", async () => {
    refuseCreate = new ConnectError("organization creation is disabled", Code.PermissionDenied);
    await expect(bootstrapBackend(stigmer)).rejects.toThrow(
      /organization creation is disabled/,
    );
  });
});

describe("bootstrapLocalBackend", () => {
  const client = { stigmer: {} as unknown as Stigmer } as unknown as BackendClient;

  it("runs the act over the local client and announces a created org", async () => {
    const said: string[] = [];
    let seen: Stigmer | undefined;
    await bootstrapLocalBackend({
      client,
      say: (line) => said.push(line),
      bootstrap: async (s) => {
        seen = s;
        return "created";
      },
    });
    expect(seen).toBe(client.stigmer);
    expect(said).toEqual([`Created the '${DEFAULT_LOCAL_ORG}' organization`]);
  });

  it("says nothing when the org is already present", async () => {
    const said: string[] = [];
    await bootstrapLocalBackend({
      client,
      say: (line) => said.push(line),
      bootstrap: async () => "present",
    });
    expect(said).toEqual([]);
  });

  it("contains a failure in one warning naming the retry", async () => {
    const said: string[] = [];
    await bootstrapLocalBackend({
      client,
      say: (line) => said.push(line),
      bootstrap: async () => {
        throw new Error("backend unreachable");
      },
    });
    expect(said).toEqual([
      "Warning: failed to bootstrap the local backend. Run 'stigmer up' again to retry.",
    ]);
  });
});
