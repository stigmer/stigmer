// Pins how the cloud target makes its people: setup takes the environment's
// direct-login tenant (and refuses to run without one) and opts the primary
// in to memory on its own account, keeping its other preferences; a person is a fresh
// console token followed by provisionMyAccount through the clients that
// present it, the outsider holds no grant, the colleague holds `member` on
// the tenancy by the organization's id and the account the first login made,
// and teardown forgets the tenant. The Managed Agents lane is served on the
// address the target dials, for its primary and its enforcing lane alike,
// and the execution target answers its inner target's. Its sign-in issuer is
// the tenant's; a teams tenancy is the plain one moved to the Team plan over
// the webhook lane, released when the move fails, and keyed on the execution
// target. The readiness probe, the plan move and the clients are stubbed;
// nothing here starts a server.
import { generateKeyPairSync } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLOUD_ENV } from "../../harness/cloud-env";
import type { ConformanceClients } from "../../harness/clients";
import { CloudTarget } from "../cloud";
import { CloudExecutionTarget } from "../cloud-execution";

vi.mock("../../harness/grpc-ready", () => ({ awaitGrpcReady: async () => {} }));

// The plan move is its own unit's (harness/__tests__/plan-move.test.ts);
// here it records what the target asked of it, and fails when told to.
const planMoves = vi.hoisted(() => ({ calls: [] as Array<{ webhook: unknown; org: string }>, fail: false }));
vi.mock("../../harness/plan-move", () => ({
  moveToTeamPlan: async (_owner: unknown, webhook: unknown, org: string) => {
    planMoves.calls.push({ webhook, org });
    if (planMoves.fail) throw new Error("the catalog lists no 'team' plan");
  },
}));

const ORG_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const TENANT_ENV: Record<string, string> = {
  [CLOUD_ENV.address]: "http://127.0.0.1:1",
  [CLOUD_ENV.token]: "primary-console-token",
  [CLOUD_ENV.directLoginIssuer]: "https://tenant.example.test/",
  [CLOUD_ENV.directLoginSigningKeyBase64]: Buffer.from(
    privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  ).toString("base64"),
  [CLOUD_ENV.directLoginKid]: "tenant-key",
  [CLOUD_ENV.directLoginApiAudience]: "https://api.example.test",
  [CLOUD_ENV.stripeWebhookAddress]: "http://127.0.0.1:7",
  [CLOUD_ENV.stripeWebhookSecret]: "whsec_conformance",
};

function subjectOf(token: string): string {
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as {
    sub?: string;
  };
  return payload.sub ?? "";
}

/** Clients that answer provisionMyAccount with `ida_<n>` per call, recording the tokens presented. */
function presentingStub(target: CloudTarget): { presented: string[] } {
  const presented: string[] = [];
  vi.spyOn(target, "clientsPresenting").mockImplementation((token: string) => {
    presented.push(token);
    return {
      identityAccountCommand: {
        provisionMyAccount: async () => ({
          metadata: { id: `ida_person${presented.length}` },
        }),
      },
    } as unknown as ConformanceClients;
  });
  return { presented };
}

/** The primary's clients as setup meets them: an account not yet opted in to memory, recording the update. */
function primaryStub(
  target: CloudTarget,
  extra: Record<string, unknown> = {},
  memoryEnabled = false,
): { updates: unknown[] } {
  const updates: unknown[] = [];
  vi.spyOn(target, "clients").mockReturnValue({
    identityAccountQuery: {
      whoAmI: async () =>
        create(IdentityAccountSchema, {
          metadata: { id: "ida_primary" },
          spec: { preferences: { standingContext: "terse", memoryEnabled } },
        }),
    },
    identityAccountCommand: {
      update: async (input: unknown) => (updates.push(input), {}),
    },
    ...extra,
  } as unknown as ConformanceClients);
  return { updates };
}

describe("the cloud target's people", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(
      Object.keys(TENANT_ENV).map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, TENANT_ENV);
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.restoreAllMocks();
  });

  it("refuses to make a person before setup", async () => {
    await expect(new CloudTarget().provisionIdentity()).rejects.toThrow(
      "CloudTarget.setup() must be called before provisionIdentity()",
    );
  });

  it("refuses to set up without the environment's direct-login tenant", async () => {
    delete process.env[CLOUD_ENV.directLoginIssuer];
    await expect(new CloudTarget().setup()).rejects.toThrow(
      CLOUD_ENV.directLoginIssuer,
    );
  });

  it("signs a fresh outsider in through the tenant and provisions the account, granting nothing", async () => {
    const target = new CloudTarget();
    const { updates } = primaryStub(target);
    await target.setup();
    expect(updates).toEqual([
      expect.objectContaining({
        resource: expect.objectContaining({
          spec: expect.objectContaining({
            preferences: expect.objectContaining({
              memoryEnabled: true,
              standingContext: "terse",
            }),
          }),
        }),
        updateMask: expect.objectContaining({ paths: ["spec.preferences.memory_enabled"] }),
      }),
    ]);
    expect(
      target.directLoginTenant?.().issuer,
      "the direct-login suite reads the same tenant",
    ).toBe(TENANT_ENV[CLOUD_ENV.directLoginIssuer]);
    const { presented } = presentingStub(target);

    await target.provisionIdentity();

    expect(presented).toHaveLength(2);
    expect(subjectOf(presented[0] ?? "")).toMatch(/^auth0\|conformance-/);
    expect(presented[1]).toBe(presented[0]);
  });

  it("grants the colleague member on the tenancy by the organization's id and the provisioned account", async () => {
    const target = new CloudTarget();
    const granted: unknown[] = [];
    primaryStub(target, {
      organizationCommand: {
        create: async () => ({
          metadata: { slug: "conformance-acme", id: ORG_ID },
        }),
      },
      grantCommand: {
        create: async (input: unknown) => (granted.push(input), {}),
      },
    });
    await target.setup();
    presentingStub(target);

    const tenancy = await target.provisionTenancy();
    await target.provisionMember(tenancy);

    expect(granted).toEqual([
      expect.objectContaining({
        principal: expect.objectContaining({
          kind: "identity_account",
          id: "ida_person1",
        }),
        resource: expect.objectContaining({ kind: "organization", id: ORG_ID }),
        relation: "member",
      }),
    ]);
  });

  it("leaves a primary already opted in to memory as it is", async () => {
    const target = new CloudTarget();
    const { updates } = primaryStub(target, {}, true);
    await target.setup();
    expect(updates).toEqual([]);
  });

  it("refuses a person whose first login answers no account", async () => {
    const target = new CloudTarget();
    primaryStub(target);
    await target.setup();
    vi.spyOn(target, "clientsPresenting").mockReturnValue({
      identityAccountCommand: { provisionMyAccount: async () => ({}) },
    } as unknown as ConformanceClients);
    await expect(target.provisionIdentity()).rejects.toThrow(
      "provisionMyAccount answered no account",
    );
  });

  it("serves the Managed Agents lane on the address it dials, for its primary and its enforcing lane", async () => {
    expect(() => new CloudTarget().managedAgentsBaseUrl()).toThrow(
      "CloudTarget.setup() must be called before managedAgentsBaseUrl()",
    );
    const target = new CloudTarget();
    primaryStub(target);
    await target.setup();
    expect(target.managedAgentsBaseUrl()).toBe(TENANT_ENV[CLOUD_ENV.address]);
    expect((await target.enforcingLane()).managedAgentsBaseUrl()).toBe(TENANT_ENV[CLOUD_ENV.address]);

    const execution = new CloudExecutionTarget();
    // The inner target setup() would connect; its accessor is what the execution target answers.
    const inner = (execution as unknown as { cloud: CloudTarget }).cloud;
    vi.spyOn(inner, "managedAgentsBaseUrl").mockReturnValue("http://127.0.0.1:9");
    expect(execution.managedAgentsBaseUrl()).toBe("http://127.0.0.1:9");
  });

  it("lends its enforcing lane an unprovisioned caller: a tenant token for a fresh subject, never provisioned", async () => {
    const target = new CloudTarget();
    primaryStub(target);
    await target.setup();
    const { presented } = presentingStub(target);

    await (await target.enforcingLane()).unprovisionedCaller?.();

    expect(presented).toHaveLength(1);
    expect(subjectOf(presented[0] ?? "")).toMatch(/^auth0\|lane-unprovisioned-/);
  });

  it("names a tenancy by its organization's id for the lane's role grants, and mints no unprovisioned caller after teardown", async () => {
    const target = new CloudTarget();
    const granted: unknown[] = [];
    primaryStub(target, {
      organizationCommand: {
        create: async () => ({ metadata: { slug: "conformance-acme", id: ORG_ID } }),
      },
      grantCommand: {
        create: async (input: unknown) => (granted.push(input), {}),
        delete: async () => ({}),
      },
    });
    await target.setup();
    vi.spyOn(target, "clientsPresenting").mockReturnValue({
      identityAccountCommand: { provisionMyAccount: async () => ({ metadata: { id: "ida_admin" } }) },
      identityAccountQuery: { whoAmI: async () => ({ metadata: { id: "ida_admin" } }) },
    } as unknown as ConformanceClients);
    const lane = await target.enforcingLane();

    await lane.provisionWithRole(await target.provisionTenancy(), "admin");
    expect(granted).toEqual([
      expect.objectContaining({ relation: "member", resource: expect.objectContaining({ id: ORG_ID }) }),
      expect.objectContaining({ relation: "admin", resource: expect.objectContaining({ id: ORG_ID }) }),
    ]);

    await target.teardown();
    await expect(lane.unprovisionedCaller?.()).rejects.toThrow(
      "CloudTarget.setup() must be called before enforcingLane()",
    );
  });

  it("names the tenant's issuer as the issuer its people sign in with, on both cloud targets", async () => {
    expect(() => new CloudTarget().signInIssuer()).toThrow(
      "CloudTarget.setup() must be called before signInIssuer()",
    );
    const target = new CloudTarget();
    primaryStub(target);
    await target.setup();
    expect(target.signInIssuer()).toBe(TENANT_ENV[CLOUD_ENV.directLoginIssuer]);

    const execution = new CloudExecutionTarget();
    const inner = (execution as unknown as { cloud: CloudTarget }).cloud;
    vi.spyOn(inner, "signInIssuer").mockReturnValue("https://inner.example.test/");
    expect(execution.signInIssuer()).toBe("https://inner.example.test/");
  });

  it("gates teams by plan and dials user-supplied addresses strictly", () => {
    const { capabilities } = new CloudTarget();
    expect(capabilities.teams).toBe("plan-gated");
    expect(capabilities.invitations).toBe(true);
    expect(capabilities.federationIssuers).toBe(true);
    expect(capabilities.outboundEgress).toBe("strict");
    expect(new CloudExecutionTarget().capabilities).toEqual(capabilities);
  });

  it("moves a teams tenancy's organization to the Team plan over the environment's webhook lane, and releases it when the move fails", async () => {
    planMoves.calls.length = 0;
    planMoves.fail = false;
    const target = new CloudTarget();
    const deleted: unknown[] = [];
    primaryStub(target, {
      organizationCommand: {
        create: async () => ({ metadata: { slug: "conformance-acme", id: ORG_ID } }),
        delete: async (input: unknown) => (deleted.push(input), {}),
      },
    });
    await target.setup();

    expect(await target.provisionTeamsTenancy()).toEqual({ org: ORG_ID });
    expect(planMoves.calls).toEqual([
      { webhook: { baseUrl: "http://127.0.0.1:7", signingSecret: "whsec_conformance" }, org: ORG_ID },
    ]);
    expect(deleted).toEqual([]);

    planMoves.fail = true;
    await expect(target.provisionTeamsTenancy()).rejects.toThrow("the catalog lists no 'team' plan");
    expect(deleted).toEqual([{ value: ORG_ID }]);
    planMoves.fail = false;
  });

  it("keys the execution target's teams tenancy, as every tenancy there", async () => {
    const execution = new CloudExecutionTarget();
    const inner = (execution as unknown as { cloud: CloudTarget }).cloud;
    vi.spyOn(inner, "provisionTeamsTenancy").mockResolvedValue({ org: ORG_ID });
    const keyed: string[] = [];
    vi.spyOn(inner, "keyTenancy").mockImplementation(async (org: string) => void keyed.push(org));

    expect(await execution.provisionTeamsTenancy()).toEqual({ org: ORG_ID });
    expect(keyed).toEqual([ORG_ID]);
  });

  it("forgets the tenant at teardown", async () => {
    const target = new CloudTarget();
    primaryStub(target);
    await target.setup();
    await target.teardown();
    await expect(target.provisionIdentity()).rejects.toThrow(
      "must be called before provisionIdentity()",
    );
  });
});
