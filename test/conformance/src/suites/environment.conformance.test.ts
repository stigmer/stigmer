// Conformance suite for the Environment domain.
// Domain: agentic / environment — a flat (non-versioned) platform resource that
// stores configuration and secret values in spec.data.
//
// Drives EnvironmentCommandController + EnvironmentQueryController through the raw
// proto stubs and asserts the contract: CRUD round-trips, apply create/update
// branching, immutable identity fields, slug semantics, reference resolution,
// incremental variable management (updateVariables/removeVariables), single-key
// secret reveal (getSecretValue), and spec-first negative paths.
//
// Secret handling is the domain's defining concern and is edition-divergent:
//   - get / list / getByReference return the secret VALUE in plaintext on OSS
//     (single-user/local) but redact it on cloud. This is gated by the
//     secretRedaction capability — the is_secret flag itself is edition-agnostic.
//   - getSecretValue is the explicit "reveal" endpoint: it returns the unredacted
//     value in BOTH editions by design (cloud gates it behind can_read_secrets),
//     so its value assertion is NOT gated.
//
// Two recorded deviations apply to create (shared with every other domain):
// duplicate-create and missing-name lose their gRPC status in the pipeline
// wrapper and surface as Unknown — see contract/deviations.ts.
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import {
  ENVIRONMENT_API_VERSION,
  ENVIRONMENT_KIND,
  makeEnvironment,
  makeEnvironmentSpec,
  type EnvironmentSpecOptions,
} from "../support/environments";
import { createTarget, type TargetProfile } from "../targets";

// The server's secret-preservation sentinel. This is a documented behavioral
// contract — not a proto field — that lets a client round-trip a redacted
// resource without clobbering the secret: sending this marker for an existing
// secret key preserves the stored value (see the server's RedactedMarker in
// environment/controller/steps/preserve_redacted_secrets.go).
const REDACTED_MARKER = "***REDACTED***";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

async function createEnvironment(org: string, name: string, opts: EnvironmentSpecOptions = {}) {
  const environment = await clients.environmentCommand.create(makeEnvironment({ org, name, ...opts }));
  fixtures.defer(() => clients.environmentCommand.delete({ resourceId: environment.metadata!.id }));
  return environment;
}

describe("Environment conformance — CRUD & identity", () => {
  it("create assigns an env_ id, echoes the spec, and records a created audit event", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("env");

    const created = await createEnvironment(org, name, { description: "staging config" });

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^env_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.description).toBe("staging config");
    expect(created.spec?.data?.PLAIN_KEY?.value).toBe("plain-value");
    expect(created.status?.audit?.specAudit?.event).toBe("created");
  });

  it("get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createEnvironment(org, uniqueName("env"));

    const fetched = await clients.environmentQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    assertResourceParity(EnvironmentSchema, created, fetched, "create vs get");
  });

  it("apply creates on first call and updates on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("env");

    const first = await clients.environmentCommand.apply(makeEnvironment({ org, name, description: "v1" }));
    fixtures.defer(() => clients.environmentCommand.delete({ resourceId: first.metadata!.id }));
    expect(first.status?.audit?.specAudit?.event).toBe("created");

    const second = await clients.environmentCommand.apply(makeEnvironment({ org, name, description: "v2" }));

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.spec?.description).toBe("v2");
    expect(second.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("update replaces spec and name but preserves id, slug, and org", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createEnvironment(org, uniqueName("env"), { description: "before" });
    const { id, slug } = created.metadata!;

    const renamed = uniqueName("renamed");
    const updated = await clients.environmentCommand.update({
      apiVersion: ENVIRONMENT_API_VERSION,
      kind: ENVIRONMENT_KIND,
      // Attempts to mutate slug/org must be ignored; only name and spec change.
      metadata: { id, name: renamed, slug: "attempted-different-slug", org: "attempted-different-org" },
      spec: makeEnvironmentSpec({ description: "after" }),
    });

    expect(updated.metadata?.id).toBe(id);
    expect(updated.metadata?.slug).toBe(slug);
    expect(updated.metadata?.org).toBe(org);
    expect(updated.metadata?.name).toBe(renamed);
    expect(updated.spec?.description).toBe("after");
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("delete returns the resource and a subsequent get reports NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const created = await clients.environmentCommand.create(makeEnvironment({ org, name: uniqueName("env") }));
    const { id } = created.metadata!;

    const deleted = await clients.environmentCommand.delete({ resourceId: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.environmentQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.environmentQuery.get({ value: "" }), Code.InvalidArgument, "get empty id"));

  it("get of a missing id returns NotFound", () =>
    expectGrpcCode(() => clients.environmentQuery.get({ value: "env_doesnotexist" }), Code.NotFound, "get missing id"));

  it("getByReference resolves by org and slug", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createEnvironment(org, uniqueName("ref"));

    const fetched = await clients.environmentQuery.getByReference({ org, slug: created.metadata!.slug });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
  });

  it("getByReference of an unknown slug returns NotFound", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.environmentQuery.getByReference({ org, slug: "does-not-exist" }),
      Code.NotFound,
      "getByReference unknown slug",
    );
  });

  it("derives a slug from the name", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createEnvironment(org, "My Staging Env #1 (Test)");
    expect(created.metadata?.slug).toBe("my-staging-env-1-test");
  });

  it("allows the same slug in different orgs", async () => {
    const a = await target.provisionTenancy();
    const b = await target.provisionTenancy();
    const name = uniqueName("shared");

    const inA = await createEnvironment(a.org, name);
    const inB = await createEnvironment(b.org, name);

    expect(inA.metadata?.slug).toBe(inB.metadata?.slug);
    expect(inA.metadata?.id).not.toBe(inB.metadata?.id);
  });
});

describe("Environment conformance — secrets", () => {
  it("read RPCs return the secret value per the secretRedaction capability; is_secret is always preserved", async () => {
    const { org } = await target.provisionTenancy();
    const secretValue = "s3cr3t-token-value";
    const created = await createEnvironment(org, uniqueName("env"), {
      data: {
        API_TOKEN: { value: secretValue, isSecret: true, description: "an API token" },
        PLAIN_HOST: { value: "example.com" },
      },
    });

    const fetched = await clients.environmentQuery.get({ value: created.metadata!.id });
    const secretEntry = fetched.spec?.data?.API_TOKEN;

    // The is_secret flag is part of the cross-edition contract regardless of value handling.
    expect(secretEntry?.isSecret, "is_secret is preserved on read in both editions").toBe(true);
    expect(fetched.spec?.data?.PLAIN_HOST?.value, "plaintext values are never redacted").toBe("example.com");

    if (target.capabilities.secretRedaction) {
      // Cloud redacts the secret value on get/list/getByReference. The exact
      // redaction representation is the cloud target's to assert; here we pin the
      // edition-agnostic guarantee: the plaintext secret never leaks on a plain read.
      expect(secretEntry?.value, "redacting targets must not return the plaintext secret").not.toBe(secretValue);
      return;
    }

    // Local OSS is single-user and returns the secret value in plaintext.
    expect(secretEntry?.value, "OSS returns the secret value in plaintext").toBe(secretValue);
  });

  it("getSecretValue reveals the unredacted secret value (both editions)", async () => {
    const { org } = await target.provisionTenancy();
    const secretValue = "reveal-me-please";
    const created = await createEnvironment(org, uniqueName("env"), {
      data: { DB_PASSWORD: { value: secretValue, isSecret: true } },
    });

    // getSecretValue is the explicit single-key reveal endpoint; unlike the bulk
    // read RPCs it returns the unredacted value in every edition.
    const revealed = await clients.environmentQuery.getSecretValue({
      environmentId: created.metadata!.id,
      key: "DB_PASSWORD",
    });
    expect(revealed.value).toBe(secretValue);
    expect(revealed.isSecret).toBe(true);
  });

  it("getSecretValue returns NotFound for a key that does not exist", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createEnvironment(org, uniqueName("env"));

    await expectGrpcCode(
      () => clients.environmentQuery.getSecretValue({ environmentId: created.metadata!.id, key: "MISSING" }),
      Code.NotFound,
      "getSecretValue missing key",
    );
  });

  it("getSecretValue rejects an empty environment_id (InvalidArgument)", () =>
    expectGrpcCode(
      () => clients.environmentQuery.getSecretValue({ environmentId: "", key: "ANY" }),
      Code.InvalidArgument,
      "getSecretValue empty environment_id",
    ));

  it("getSecretValue rejects an empty key (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createEnvironment(org, uniqueName("env"));
    await expectGrpcCode(
      () => clients.environmentQuery.getSecretValue({ environmentId: created.metadata!.id, key: "" }),
      Code.InvalidArgument,
      "getSecretValue empty key",
    );
  });
});

describe("Environment conformance — redaction-marker preservation", () => {
  // The full-resource update replaces spec.data wholesale, which would destroy a
  // secret a client cannot read back. The redaction marker is the contract that
  // lets an edit flow preserve secrets it did not intend to change.
  it("update preserves an existing secret value when the redaction marker is sent back", async () => {
    const { org } = await target.provisionTenancy();
    const realSecret = "original-secret-value";
    const created = await createEnvironment(org, uniqueName("env"), {
      data: { API_KEY: { value: realSecret, isSecret: true } },
    });
    const { id } = created.metadata!;

    // Re-submit the secret key carrying the marker instead of the real value.
    await clients.environmentCommand.update({
      apiVersion: ENVIRONMENT_API_VERSION,
      kind: ENVIRONMENT_KIND,
      metadata: { id, name: created.metadata!.name, org },
      spec: makeEnvironmentSpec({ data: { API_KEY: { value: REDACTED_MARKER, isSecret: true } } }),
    });

    // The stored value must still be the original — verified via the reveal endpoint.
    const revealed = await clients.environmentQuery.getSecretValue({ environmentId: id, key: "API_KEY" });
    expect(revealed.value, "the marker must not overwrite the stored secret").toBe(realSecret);
  });

  it("update rejects the redaction marker for a key with no prior secret (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createEnvironment(org, uniqueName("env"));
    const { id } = created.metadata!;

    // NEW_SECRET has no prior stored value to preserve, so the marker is meaningless.
    await expectGrpcCode(
      () =>
        clients.environmentCommand.update({
          apiVersion: ENVIRONMENT_API_VERSION,
          kind: ENVIRONMENT_KIND,
          metadata: { id, name: created.metadata!.name, org },
          spec: makeEnvironmentSpec({ data: { NEW_SECRET: { value: REDACTED_MARKER, isSecret: true } } }),
        }),
      Code.InvalidArgument,
      "redaction marker for a non-existent secret",
    );
  });
});

describe("Environment conformance — incremental variable management", () => {
  it("updateVariables merges new keys while preserving existing ones", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createEnvironment(org, uniqueName("env"), {
      data: { KEEP_ME: { value: "keep" } },
    });
    const { id } = created.metadata!;

    const merged = await clients.environmentCommand.updateVariables({
      environmentId: id,
      variables: {
        ADD_ME: { value: "added", isSecret: false, description: "" },
        KEEP_ME: { value: "overwritten", isSecret: false, description: "" },
      },
    });

    expect(merged.spec?.data?.ADD_ME?.value, "new keys are added").toBe("added");
    expect(merged.spec?.data?.KEEP_ME?.value, "existing keys in the request are overwritten").toBe("overwritten");
  });

  it("updateVariables leaves keys absent from the request untouched", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createEnvironment(org, uniqueName("env"), {
      data: { UNTOUCHED: { value: "stable" }, CHANGED: { value: "before" } },
    });
    const { id } = created.metadata!;

    const merged = await clients.environmentCommand.updateVariables({
      environmentId: id,
      variables: { CHANGED: { value: "after", isSecret: false, description: "" } },
    });

    expect(merged.spec?.data?.UNTOUCHED?.value, "keys not in the request are preserved").toBe("stable");
    expect(merged.spec?.data?.CHANGED?.value).toBe("after");
  });

  it("removeVariables deletes the named keys and ignores unknown ones", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createEnvironment(org, uniqueName("env"), {
      data: { DROP_ME: { value: "gone" }, KEEP_ME: { value: "stays" } },
    });
    const { id } = created.metadata!;

    const after = await clients.environmentCommand.removeVariables({
      environmentId: id,
      keys: ["DROP_ME", "NEVER_EXISTED"],
    });

    expect(after.spec?.data?.DROP_ME, "named keys are removed").toBeUndefined();
    expect(after.spec?.data?.KEEP_ME?.value, "other keys remain").toBe("stays");
  });

  it("removeVariables rejects an empty key list (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createEnvironment(org, uniqueName("env"));
    await expectGrpcCode(
      () => clients.environmentCommand.removeVariables({ environmentId: created.metadata!.id, keys: [] }),
      Code.InvalidArgument,
      "removeVariables empty keys",
    );
  });
});

describe("Environment conformance — list", () => {
  it("lists environments filtered by org", async () => {
    const { org } = await target.provisionTenancy();
    const a = await createEnvironment(org, uniqueName("env"));
    const b = await createEnvironment(org, uniqueName("env"));

    const list = await clients.environmentQuery.list({ org });

    const ids = list.items.map((item) => item.metadata?.id);
    expect(ids, "the list contains both created environments").toEqual(expect.arrayContaining([a.metadata?.id, b.metadata?.id]));
  });

  it("rejects a list with no org (InvalidArgument)", () =>
    expectGrpcCode(() => clients.environmentQuery.list({ org: "" }), Code.InvalidArgument, "list empty org"));
});

describe("Environment conformance — negative paths", () => {
  it("rejects a wrong api_version (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.environmentCommand.create({
          apiVersion: "wrong.stigmer.ai/v1",
          kind: ENVIRONMENT_KIND,
          metadata: { name: uniqueName("env"), org },
          spec: makeEnvironmentSpec(),
        }),
      Code.InvalidArgument,
      "create with wrong api_version",
    );
  });

  it("rejects a wrong kind (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.environmentCommand.create({
          apiVersion: ENVIRONMENT_API_VERSION,
          kind: "NotAnEnvironment",
          metadata: { name: uniqueName("env"), org },
          spec: makeEnvironmentSpec(),
        }),
      Code.InvalidArgument,
      "create with wrong kind",
    );
  });

  it("rejects a duplicate create (contract: AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("dup");
    await createEnvironment(org, name);

    await expectGrpcCode(
      () => clients.environmentCommand.create(makeEnvironment({ org, name })),
      Code.AlreadyExists,
      "duplicate create",
    );
  });

  it("rejects a create with no name (contract: InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // Spec is valid so Layer 1 passes; the empty name is what must be rejected
    // (slug resolution has nothing to derive from).
    await expectGrpcCode(
      () =>
        clients.environmentCommand.create({
          apiVersion: ENVIRONMENT_API_VERSION,
          kind: ENVIRONMENT_KIND,
          metadata: { org },
          spec: makeEnvironmentSpec(),
        }),
      Code.InvalidArgument,
      "create without name",
    );
  });

  it("rejects a duplicate personal environment with a real AlreadyExists", async () => {
    const { org } = await target.provisionTenancy();
    // The personal-environment uniqueness step returns a real gRPC status
    // (codes.AlreadyExists), unlike the generic slug CheckDuplicateStep whose
    // plain error degrades to Unknown. This documents that the deviation is a
    // property of the generic step, not of duplicate detection itself.
    const first = await clients.environmentCommand.create({
      apiVersion: ENVIRONMENT_API_VERSION,
      kind: ENVIRONMENT_KIND,
      metadata: { name: uniqueName("personal"), org, labels: { "stigmer.ai/personal": "true" } },
      spec: makeEnvironmentSpec(),
    });
    fixtures.defer(() => clients.environmentCommand.delete({ resourceId: first.metadata!.id }));

    await expectGrpcCode(
      () =>
        clients.environmentCommand.create({
          apiVersion: ENVIRONMENT_API_VERSION,
          kind: ENVIRONMENT_KIND,
          metadata: { name: uniqueName("personal"), org, labels: { "stigmer.ai/personal": "true" } },
          spec: makeEnvironmentSpec(),
        }),
      Code.AlreadyExists,
      "duplicate personal environment",
    );
  });

  it("allows a personal environment in each org (per-org uniqueness)", async () => {
    // Personal-environment uniqueness is scoped to the org: a personal env in one
    // org must never block creating one in another. Regression guard for the
    // cross-tenant leak reported in stigmer/stigmer#193.
    const a = await target.provisionTenancy();
    const b = await target.provisionTenancy();

    const makePersonal = (org: string) => ({
      apiVersion: ENVIRONMENT_API_VERSION,
      kind: ENVIRONMENT_KIND,
      metadata: { name: uniqueName("personal"), org, labels: { "stigmer.ai/personal": "true" } },
      spec: makeEnvironmentSpec(),
    });

    const inA = await clients.environmentCommand.create(makePersonal(a.org));
    fixtures.defer(() => clients.environmentCommand.delete({ resourceId: inA.metadata!.id }));
    const inB = await clients.environmentCommand.create(makePersonal(b.org));
    fixtures.defer(() => clients.environmentCommand.delete({ resourceId: inB.metadata!.id }));

    expect(inA.metadata?.org).toBe(a.org);
    expect(inB.metadata?.org).toBe(b.org);
    expect(inA.metadata?.id).not.toBe(inB.metadata?.id);
  });
});
