// Pins how the enterprise target stands up and drives its licensed server:
// setup spawns Enterprise's test entry under the repository's tsx loader on
// a throwaway Postgres database, in the OIDC posture against the harness's
// issuer with the relaxed outbound posture, and signs the founder in (readiness, then provisionMyAccount, then
// the memory opt-in); people are fresh issuer subjects provisioned the same
// way, the outsider granted nothing and the colleague `member` on the
// tenancy by its organization's id; tenancies are organizations deleted once
// by id; the enforcing lane is the primary, with an issuer-minted
// unprovisioned caller; a sibling is the same entry on its own database in
// the env the suite names, released when its spawn fails; the primary
// trusts one certificate minted at setup through NODE_EXTRA_CA_CERTS, and
// an outside issuer serves TLS with exactly that certificate; the sign-in
// issuer is the harness's; a teams tenancy is the plain tenancy; teardown
// stops the server, drops its database, closes the issuer and removes the
// trusted file; a sibling restarts over the same database in the env the
// restart names, its clients following the new address, and a restart that
// does not come back releases the database once. The build, the spawns, the
// database, the issuers and the readiness gate are stubbed; nothing here
// starts a server.
import { existsSync, readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConformanceClients } from "../../harness/clients";

interface Spawn {
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
  readonly readyTimeoutMs?: number;
}

const spawned: Spawn[] = [];
const stopped: string[] = [];
const released: string[] = [];
const readinessBearers: string[] = [];
// The log tail each readiness gate would print on failure.
const logTails: string[] = [];
let failNextReadiness = false;
let databases = 0;
let failNextSpawn = false;
let issuerClosed = false;
// The options each issuer was started with: the target's own first, then
// any outside issuer.
const issuerStarts: unknown[] = [];

vi.mock("@stigmer/test-support/ts-build", () => ({
  ensureEnterpriseServerEntry: async () => "/ee/server/test/conformance/licensed-server.ts",
  tsxLoaderUrl: () => "file:///repo/node_modules/tsx/dist/loader.mjs",
}));

vi.mock("@stigmer/test-support/server-process", () => ({
  spawnServer: async (_node: string, options: Spawn) => {
    if (failNextSpawn) {
      failNextSpawn = false;
      throw new Error("boot failed: the sibling's posture");
    }
    spawned.push(options);
    const baseUrl = `http://127.0.0.1:${spawned.length}`;
    return { baseUrl, logTail: () => `log of ${baseUrl}`, stop: async () => void stopped.push(baseUrl) };
  },
}));

vi.mock("../../harness/postgres", () => ({
  provisionPostgresStorage: async () => {
    databases += 1;
    const databaseUrl = `postgres://db/${databases}`;
    return { serverEnv: { DATABASE_URL: databaseUrl }, release: async () => void released.push(databaseUrl) };
  },
}));

vi.mock("@stigmer/test-support/local-oidc-issuer", () => ({
  startLocalOidcIssuer: async (options: unknown = {}) => (issuerStarts.push(options), {
    issuer: "http://127.0.0.1:9/issuer",
    audience: "https://conformance.stigmer.test/api",
    // The token names what was minted, so an arm can read it back.
    mint: async (input: { sub: string; email: string; ttlSeconds?: number }) =>
      JSON.stringify({ sub: input.sub, ttlSeconds: input.ttlSeconds ?? null }),
    close: async () => {
      issuerClosed = true;
    },
  }),
}));

// A transport is its address and bearer, so an arm can read who a sibling's
// readiness gate presented.
vi.mock("../../harness/clients", () => ({
  createTransport: (baseUrl: string, options: { bearerToken?: string } = {}) => ({
    baseUrl,
    bearerToken: options.bearerToken ?? "",
  }),
  makeClients: (transport: { bearerToken: string }) => ({ readinessBearer: transport.bearerToken }),
}));

vi.mock("../../harness/grpc-ready", () => ({
  awaitGrpcReady: async (clients: { readinessBearer?: string }, logTail: () => string) => {
    readinessBearers.push(clients.readinessBearer ?? "");
    logTails.push(logTail());
    if (failNextReadiness) {
      failNextReadiness = false;
      throw new Error("gRPC readiness gate failed");
    }
  },
}));

const { EnterpriseTarget } = await import("../enterprise");
const { createTarget } = await import("../index");
type Target = InstanceType<typeof EnterpriseTarget>;

const ORG_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const EIGHT_HOURS = 8 * 60 * 60;

/** What the stubbed clients saw. */
interface Seen {
  readonly presented: string[];
  readonly provisioned: string[];
  readonly memoryUpdates: unknown[];
  readonly grants: unknown[];
  readonly deletedOrganizations: unknown[];
}

/** Clients for every token the target presents, answering provisionMyAccount with `ida_<n>`. */
function stubClients(target: Target): Seen {
  const seen: Seen = { presented: [], provisioned: [], memoryUpdates: [], grants: [], deletedOrganizations: [] };
  const byToken = new Map<string, ConformanceClients>();
  vi.spyOn(target, "clientsPresenting").mockImplementation((token: string) => {
    seen.presented.push(token);
    const known = byToken.get(token);
    if (known !== undefined) return known;
    const clients = {
      readinessBearer: token,
      identityAccountCommand: {
        provisionMyAccount: async () => {
          seen.provisioned.push(token);
          return { metadata: { id: `ida_person${seen.provisioned.length}` } };
        },
        update: async (input: unknown) => void seen.memoryUpdates.push(input),
      },
      identityAccountQuery: {
        whoAmI: async () =>
          create(IdentityAccountSchema, {
            metadata: { id: "ida_person1" },
            spec: { preferences: { memoryEnabled: false } },
          }),
      },
      organizationCommand: {
        create: async () => ({ metadata: { slug: "conformance-acme", id: ORG_ID } }),
        delete: async (input: unknown) => void seen.deletedOrganizations.push(input),
      },
      grantCommand: {
        create: async (input: unknown) => (seen.grants.push(input), {}),
        delete: async () => ({}),
      },
    } as unknown as ConformanceClients;
    byToken.set(token, clients);
    return clients;
  });
  return seen;
}

function minted(token: string): { sub: string; ttlSeconds: number | null } {
  return JSON.parse(token) as { sub: string; ttlSeconds: number | null };
}

beforeEach(() => {
  spawned.length = 0;
  stopped.length = 0;
  released.length = 0;
  readinessBearers.length = 0;
  logTails.length = 0;
  failNextReadiness = false;
  databases = 0;
  failNextSpawn = false;
  issuerClosed = false;
  issuerStarts.length = 0;
  vi.restoreAllMocks();
});

describe("the enterprise target", () => {
  it("is the target CONFORMANCE_TARGET=enterprise selects", () => {
    const saved = process.env.CONFORMANCE_TARGET;
    process.env.CONFORMANCE_TARGET = "enterprise";
    try {
      expect(createTarget()).toBeInstanceOf(EnterpriseTarget);
    } finally {
      if (saved === undefined) delete process.env.CONFORMANCE_TARGET;
      else process.env.CONFORMANCE_TARGET = saved;
    }
  });

  it("refuses to be driven before setup", async () => {
    const target = new EnterpriseTarget();
    expect(() => target.clients()).toThrow("EnterpriseTarget.setup() must be called before clients()");
    expect(() => target.httpBaseUrl()).toThrow("EnterpriseTarget.setup() must be called before httpBaseUrl()");
    await expect(target.provisionIdentity()).rejects.toThrow(
      "EnterpriseTarget.setup() must be called before provisionIdentity()",
    );
    await expect(target.enforcingLane()).rejects.toThrow(
      "EnterpriseTarget.setup() must be called before enforcingLane()",
    );
    expect(() => target.signInIssuer()).toThrow("EnterpriseTarget.setup() must be called before signInIssuer()");
    expect(() => target.startOutsideIssuer()).toThrow(
      "EnterpriseTarget.setup() must be called before startOutsideIssuer()",
    );
  });

  it("spawns the licensed test entry under the tsx loader on its own database, in the OIDC posture with relaxed egress, and signs the founder in", async () => {
    const target = new EnterpriseTarget();
    const seen = stubClients(target);
    await target.setup();

    expect(spawned).toEqual([
      {
        args: [
          "--import",
          "file:///repo/node_modules/tsx/dist/loader.mjs",
          "/ee/server/test/conformance/licensed-server.ts",
        ],
        env: {
          DATABASE_URL: "postgres://db/1",
          STIGMER_OIDC_ISSUER: "http://127.0.0.1:9/issuer",
          STIGMER_OIDC_AUDIENCE: "https://conformance.stigmer.test/api",
          STIGMER_OUTBOUND_EGRESS: "relaxed",
          NODE_EXTRA_CA_CERTS: expect.stringMatching(/outside-issuers\.pem$/),
        },
        readyTimeoutMs: 45_000,
      },
    ]);
    // Readiness presents the founder's token, then their first sign-in
    // makes the account, and the account opts in to memory.
    const [founderToken] = seen.presented;
    expect(readinessBearers).toEqual([founderToken]);
    expect(seen.provisioned).toEqual([founderToken]);
    expect(minted(founderToken ?? "")).toEqual({ sub: expect.stringMatching(/^auth0\|conformance-/), ttlSeconds: EIGHT_HOURS });
    expect(seen.memoryUpdates).toHaveLength(1);
    expect(target.clients()).toBe(target.clientsPresenting(founderToken ?? ""));
    expect(logTails, "a failed readiness prints the primary's log").toEqual(["log of http://127.0.0.1:1"]);
    expect(target.httpBaseUrl()).toBe("http://127.0.0.1:1");
    expect(target.managedAgentsBaseUrl()).toBe("http://127.0.0.1:1");
  });

  it("trusts one certificate for 127.0.0.1 on the primary, serves the outside issuer with it, and names the harness's issuer as its sign-in issuer", async () => {
    const target = new EnterpriseTarget();
    stubClients(target);
    await target.setup();

    const trustFile = spawned[0]?.env.NODE_EXTRA_CA_CERTS ?? "";
    const trusted = readFileSync(trustFile, "utf8");
    expect(new X509Certificate(trusted).checkIP("127.0.0.1")).toBe("127.0.0.1");

    await target.startOutsideIssuer();
    expect(issuerStarts).toEqual([{}, { tls: { certPem: trusted, keyPem: expect.stringContaining("PRIVATE KEY") } }]);
    expect(target.signInIssuer()).toBe("http://127.0.0.1:9/issuer");

    await target.teardown();
    expect(existsSync(trustFile), "teardown removes the trusted file").toBe(false);
  });

  it("gives a teams tenancy as the plain tenancy: a licensed server's organizations all have teams", async () => {
    const target = new EnterpriseTarget();
    const seen = stubClients(target);
    await target.setup();

    expect(await target.provisionTeamsTenancy()).toEqual({ org: ORG_ID });
    await target.cleanupTenancy({ org: ORG_ID });
    expect(seen.deletedOrganizations).toEqual([{ value: ORG_ID }]);
  });

  it("builds clients that present nothing, or exactly the bearer given, against its server", async () => {
    const target = new EnterpriseTarget();
    stubClients(target);
    await target.setup();
    vi.restoreAllMocks();

    expect(target.anonymousClients()).toEqual({ readinessBearer: "" });
    expect(target.clientsPresenting("someone's token")).toEqual({ readinessBearer: "someone's token" });
  });

  it("signs a fresh outsider in and grants nothing; grants the colleague member on the tenancy by the organization's id", async () => {
    const target = new EnterpriseTarget();
    const seen = stubClients(target);
    await target.setup();

    await target.provisionIdentity();
    expect(seen.grants).toEqual([]);
    const outsider = seen.provisioned.at(-1) ?? "";
    expect(minted(outsider).ttlSeconds).toBe(EIGHT_HOURS);
    expect(minted(outsider).sub).not.toBe(minted(seen.provisioned[0] ?? "").sub);

    const tenancy = await target.provisionTenancy();
    expect(tenancy).toEqual({ org: ORG_ID });
    await target.provisionMember(tenancy);
    expect(seen.grants).toEqual([
      expect.objectContaining({
        principal: expect.objectContaining({ kind: "identity_account", id: "ida_person3" }),
        resource: expect.objectContaining({ kind: "organization", id: ORG_ID }),
        relation: "member",
      }),
    ]);

    await target.cleanupTenancy(tenancy);
    await target.cleanupTenancy(tenancy);
    expect(seen.deletedOrganizations).toEqual([{ value: ORG_ID }]);
    await expect(target.provisionMember(tenancy)).rejects.toThrow(
      `provisionMember: tenancy "${ORG_ID}" was not provisioned by this target (provisionTenancy() first)`,
    );
  });

  it("lends its primary as the enforcing lane, with an issuer-minted caller who has no account", async () => {
    const target = new EnterpriseTarget();
    const seen = stubClients(target);
    await target.setup();
    const lane = await target.enforcingLane();

    expect(lane.clients).toBe(target.clients());
    expect(lane.managedAgentsBaseUrl()).toBe("http://127.0.0.1:1");
    const provisionedBefore = seen.provisioned.length;
    await lane.unprovisionedCaller?.();
    const stranger = seen.presented.at(-1) ?? "";
    expect(minted(stranger).sub).toMatch(/^auth0\|conformance-/);
    expect(seen.provisioned, "the stranger is never provisioned").toHaveLength(provisionedBefore);

    const tenancy = await lane.provisionTenancy();
    await lane.provisionWithRole(tenancy, "admin");
    expect(seen.grants).toEqual([
      expect.objectContaining({ relation: "member" }),
      expect.objectContaining({ relation: "admin" }),
    ]);
    await lane.provisionIdentity();
    expect(seen.grants, "the lane's outsider is granted nothing").toHaveLength(2);
    await lane.cleanupTenancy(tenancy);
    expect(seen.deletedOrganizations).toEqual([{ value: ORG_ID }]);
  });

  it("spawns a sibling of the same entry on its own database in the suite's env, and stops it with its database", async () => {
    const target = new EnterpriseTarget();
    stubClients(target);
    await target.setup();

    const sibling = await target.spawnSibling({
      env: { STIGMER_OIDC_ISSUER: "http://127.0.0.1:8/other", STIGMER_TEST_LICENSE_TERMS: '{"maxOrgs":1}' },
      readinessBearer: "sibling-reader",
    });
    expect(spawned[1]).toEqual({
      args: spawned[0]?.args,
      env: {
        DATABASE_URL: "postgres://db/2",
        STIGMER_OIDC_ISSUER: "http://127.0.0.1:8/other",
        STIGMER_TEST_LICENSE_TERMS: '{"maxOrgs":1}',
      },
      readyTimeoutMs: 45_000,
    });
    expect(readinessBearers.at(-1)).toBe("sibling-reader");
    expect(sibling.managedAgentsBaseUrl()).toBe("http://127.0.0.1:2");

    await sibling.teardown();
    expect(stopped).toEqual(["http://127.0.0.1:2"]);
    expect(released).toEqual(["postgres://db/2"]);
  });

  it("stops a sibling and drops its database when its readiness fails, printing its log", async () => {
    const target = new EnterpriseTarget();
    stubClients(target);
    await target.setup();

    failNextReadiness = true;
    await expect(target.spawnSibling({ env: {}, readinessBearer: "sibling-reader" })).rejects.toThrow(
      "gRPC readiness gate failed",
    );
    expect(logTails.at(-1)).toBe("log of http://127.0.0.1:2");
    expect(stopped).toEqual(["http://127.0.0.1:2"]);
    expect(released).toEqual(["postgres://db/2"]);
  });

  it("restarts a sibling over the same database in the env the restart names, and its clients follow the new address", async () => {
    const target = new EnterpriseTarget();
    stubClients(target);
    await target.setup();
    const sibling = await target.spawnSibling({
      env: { STIGMER_OIDC_ISSUER: "http://127.0.0.1:8/other", STIGMER_TEST_LICENSE_TERMS: "" },
      readinessBearer: "sibling-reader",
    });

    await sibling.restart?.({
      env: { STIGMER_OIDC_ISSUER: "http://127.0.0.1:8/other", STIGMER_TEST_LICENSE_TERMS: '{"days":1}' },
      readinessBearer: "after-restart",
    });
    expect(stopped, "the first process stops").toEqual(["http://127.0.0.1:2"]);
    expect(spawned[2]?.env, "the same database, and only the env the restart names").toEqual({
      DATABASE_URL: "postgres://db/2",
      STIGMER_OIDC_ISSUER: "http://127.0.0.1:8/other",
      STIGMER_TEST_LICENSE_TERMS: '{"days":1}',
    });
    expect(readinessBearers.at(-1)).toBe("after-restart");
    expect(released, "a restart keeps the database").toEqual([]);
    expect(sibling.managedAgentsBaseUrl()).toBe("http://127.0.0.1:3");
    expect(sibling.clientsPresenting("someone")).toEqual({ readinessBearer: "someone" });

    await sibling.teardown();
    expect(stopped).toEqual(["http://127.0.0.1:2", "http://127.0.0.1:3"]);
    expect(released).toEqual(["postgres://db/2"]);
  });

  it("releases the database once when a restart does not come back, and refuses to be driven after", async () => {
    const target = new EnterpriseTarget();
    stubClients(target);
    await target.setup();
    const sibling = await target.spawnSibling({ env: {}, readinessBearer: "sibling-reader" });

    failNextSpawn = true;
    await expect(sibling.restart?.({ env: {}, readinessBearer: "" })).rejects.toThrow("boot failed: the sibling's posture");
    expect(released).toEqual(["postgres://db/2"]);
    expect(() => sibling.managedAgentsBaseUrl()).toThrow("the sibling is stopped: its restart did not come back");
    await sibling.teardown();
    expect(released, "teardown after a failed restart releases nothing twice").toEqual(["postgres://db/2"]);
  });

  it("stops a restarted sibling and releases its database when its readiness fails", async () => {
    const target = new EnterpriseTarget();
    stubClients(target);
    await target.setup();
    const sibling = await target.spawnSibling({ env: {}, readinessBearer: "sibling-reader" });

    failNextReadiness = true;
    await expect(sibling.restart?.({ env: {}, readinessBearer: "" })).rejects.toThrow("gRPC readiness gate failed");
    expect(logTails.at(-1)).toBe("log of http://127.0.0.1:3");
    expect(stopped).toEqual(["http://127.0.0.1:2", "http://127.0.0.1:3"]);
    expect(released).toEqual(["postgres://db/2"]);
  });

  it("releases a sibling's database when its spawn fails", async () => {
    const target = new EnterpriseTarget();
    stubClients(target);
    await target.setup();

    failNextSpawn = true;
    await expect(target.spawnSibling({ env: {}, readinessBearer: "" })).rejects.toThrow(
      "boot failed: the sibling's posture",
    );
    expect(released).toEqual(["postgres://db/2"]);
  });

  it("stops the server, drops its database and closes the issuer at teardown, then refuses to be driven", async () => {
    const target = new EnterpriseTarget();
    stubClients(target);
    await target.setup();
    await target.teardown();

    expect(stopped).toEqual(["http://127.0.0.1:1"]);
    expect(released).toEqual(["postgres://db/1"]);
    expect(issuerClosed).toBe(true);
    await expect(target.provisionIdentity()).rejects.toThrow("must be called before provisionIdentity()");
  });
});
