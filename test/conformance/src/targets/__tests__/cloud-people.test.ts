// Pins how the cloud target makes its people: setup takes the environment's
// direct-login tenant (and refuses to run without one) and opts the primary
// in to memory on its own account, keeping its other preferences; a person is a fresh
// console token followed by provisionMyAccount through the clients that
// present it, the outsider holds no grant, the colleague holds `member` on
// the tenancy by the organization's id and the account the first login made,
// and teardown forgets the tenant. The readiness probe and the clients are
// stubbed; nothing here starts a server.
import { generateKeyPairSync } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLOUD_ENV } from "../../harness/cloud-env";
import type { ConformanceClients } from "../../harness/clients";
import { CloudTarget } from "../cloud";

vi.mock("../../harness/grpc-ready", () => ({ awaitGrpcReady: async () => {} }));

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
        spec: expect.objectContaining({
          preferences: expect.objectContaining({
            memoryEnabled: true,
            standingContext: "terse",
          }),
        }),
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
      iamPolicyCommand: {
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
