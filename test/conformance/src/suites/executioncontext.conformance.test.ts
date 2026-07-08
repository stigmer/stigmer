// Conformance suite for the ExecutionContext domain.
// Domain: agentic / executioncontext — the execution-scoped, flat resource the
// engine creates to carry one run's merged runtime configuration and secrets.
//
// Drives ExecutionContextCommandController + ExecutionContextQueryController
// through the raw proto stubs. ExecutionContext diverges from the other flat
// domains in two contract-significant ways:
//   - There is NO update RPC and NO list RPC. Reads are by id, by reference
//     (org + slug), or by the parent execution_id (getByExecutionId).
//   - apply is create-or-FAIL: applying over an existing slug returns a real
//     AlreadyExists (apply.go), not an update. create's duplicate check is the
//     shared CheckDuplicateStep, which returns a typed AlreadyExists on every
//     target — same contract as apply, reached via a different path.
//
// envmerge precedence (how spec.data is populated from layered Environments at
// execution start) is intentionally out of scope: it is only observable after a
// live execution and is covered by the execution-lifecycle session. Here we test
// the resource's own API contract by creating contexts directly.
//
// Secret value handling mirrors Environment: get/getByReference/getByExecutionId
// return the value in plaintext on OSS and redact it on cloud (gated by
// secretRedaction); the is_secret flag is edition-agnostic.
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import {
  EXECUTION_CONTEXT_API_VERSION,
  EXECUTION_CONTEXT_KIND,
  makeExecutionContext,
  makeExecutionContextSpec,
  type ExecutionContextSpecOptions,
} from "../support/executioncontexts";
import { createTarget, type TargetProfile } from "../targets";

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

async function createExecutionContext(org: string, name: string, opts: ExecutionContextSpecOptions = {}) {
  const context = await clients.executionContextCommand.create(makeExecutionContext({ org, name, ...opts }));
  fixtures.defer(() => clients.executionContextCommand.delete({ resourceId: context.metadata!.id }));
  return context;
}

describe("ExecutionContext conformance — CRUD & identity", () => {
  it("create assigns an ectx_ id, echoes the spec, and records a created audit event", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("ectx");
    const executionId = uniqueName("aex");

    const created = await createExecutionContext(org, name, { executionId });

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^ectx_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.executionId).toBe(executionId);
    expect(created.spec?.data?.PLAIN_KEY?.value).toBe("plain-value");
    expect(created.status?.audit?.specAudit?.event).toBe("created");
  });

  it("get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createExecutionContext(org, uniqueName("ectx"));

    const fetched = await clients.executionContextQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    assertResourceParity(ExecutionContextSchema, created, fetched, "create vs get");
  });

  it("delete returns the resource and a subsequent get reports NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const created = await clients.executionContextCommand.create(makeExecutionContext({ org, name: uniqueName("ectx") }));
    const { id } = created.metadata!;

    const deleted = await clients.executionContextCommand.delete({ resourceId: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.executionContextQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.executionContextQuery.get({ value: "" }), Code.InvalidArgument, "get empty id"));

  it("get of a missing id returns NotFound", () =>
    expectGrpcCode(
      () => clients.executionContextQuery.get({ value: "ectx_doesnotexist" }),
      Code.NotFound,
      "get missing id",
    ));

  it("getByReference resolves by org and slug", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createExecutionContext(org, uniqueName("ref"));

    const fetched = await clients.executionContextQuery.getByReference({ org, slug: created.metadata!.slug });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
  });

  it("getByReference of an unknown slug returns NotFound", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.executionContextQuery.getByReference({ org, slug: "does-not-exist" }),
      Code.NotFound,
      "getByReference unknown slug",
    );
  });

  it("getByReference rejects a kind that does not match the service", () =>
    expectGrpcCode(
      () => clients.executionContextQuery.getByReference({ org: "acme", slug: "web-search", kind: ApiResourceKind.agent }),
      Code.InvalidArgument,
      "getByReference kind mismatch",
    ));

  it("derives a slug from the name", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createExecutionContext(org, "Exec Ctx #1 (Run)");
    expect(created.metadata?.slug).toBe("exec-ctx-1-run");
  });
});

describe("ExecutionContext conformance — execution lookup", () => {
  it("getByExecutionId resolves a context by its parent execution_id", async () => {
    const { org } = await target.provisionTenancy();
    const executionId = uniqueName("aex");
    const created = await createExecutionContext(org, uniqueName("ectx"), { executionId });

    const fetched = await clients.executionContextQuery.getByExecutionId({ executionId });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    expect(fetched.spec?.executionId).toBe(executionId);
  });

  it("getByExecutionId returns NotFound for an unknown execution_id", async () => {
    await expectGrpcCode(
      () => clients.executionContextQuery.getByExecutionId({ executionId: uniqueName("aex-missing") }),
      Code.NotFound,
      "getByExecutionId unknown execution_id",
    );
  });

  it("getByExecutionId rejects an empty execution_id (InvalidArgument)", () =>
    expectGrpcCode(
      () => clients.executionContextQuery.getByExecutionId({ executionId: "" }),
      Code.InvalidArgument,
      "getByExecutionId empty execution_id",
    ));
});

describe("ExecutionContext conformance — apply (create-or-fail)", () => {
  it("apply creates the context on the first call", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("ectx");

    const applied = await clients.executionContextCommand.apply(makeExecutionContext({ org, name }));
    fixtures.defer(() => clients.executionContextCommand.delete({ resourceId: applied.metadata!.id }));

    expect(applied.metadata?.id).toMatch(/^ectx_[0-9a-z]+$/);
    expect(applied.status?.audit?.specAudit?.event).toBe("created");
  });

  it("apply over an existing context returns AlreadyExists (no update path)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("ectx");

    const first = await clients.executionContextCommand.apply(makeExecutionContext({ org, name }));
    fixtures.defer(() => clients.executionContextCommand.delete({ resourceId: first.metadata!.id }));

    // ExecutionContext has no update RPC; apply over an existing slug returns a
    // real AlreadyExists (apply.go) — the same code create returns for a duplicate.
    await expectGrpcCode(
      () => clients.executionContextCommand.apply(makeExecutionContext({ org, name })),
      Code.AlreadyExists,
      "apply over existing context",
    );
  });
});

describe("ExecutionContext conformance — secrets", () => {
  it("read returns the secret value per the secretRedaction capability; is_secret is always preserved", async () => {
    const { org } = await target.provisionTenancy();
    const secretValue = "runtime-secret-value";
    const created = await createExecutionContext(org, uniqueName("ectx"), {
      data: {
        AWS_SECRET_ACCESS_KEY: { value: secretValue, isSecret: true },
        AWS_REGION: { value: "us-east-1" },
      },
    });

    const fetched = await clients.executionContextQuery.get({ value: created.metadata!.id });
    const secretEntry = fetched.spec?.data?.AWS_SECRET_ACCESS_KEY;

    expect(secretEntry?.isSecret, "is_secret is preserved on read in both editions").toBe(true);
    expect(fetched.spec?.data?.AWS_REGION?.value, "plaintext values are never redacted").toBe("us-east-1");

    if (target.capabilities.secretRedaction) {
      expect(secretEntry?.value, "redacting targets must not return the plaintext secret").not.toBe(secretValue);
      return;
    }

    expect(secretEntry?.value, "OSS returns the secret value in plaintext").toBe(secretValue);
  });

  it("getByExecutionId under a user token follows the same secret contract as get", async () => {
    // On cloud, getByExecutionId decrypts only for runner-class credentials
    // (token_type of sandbox / workflow_sandbox / connect_sandbox /
    // embedded_runner). The conformance harness authenticates as a user, so it
    // must see the same redaction as get — this is the stigmer-cloud#152
    // contract: no read RPC hands plaintext secrets to a user-class caller.
    // OSS has no redaction, so the value comes back in plaintext.
    const { org } = await target.provisionTenancy();
    const secretValue = "runtime-secret-value";
    const executionId = uniqueName("aex");
    await createExecutionContext(org, uniqueName("ectx"), {
      executionId,
      data: {
        AWS_SECRET_ACCESS_KEY: { value: secretValue, isSecret: true },
        AWS_REGION: { value: "us-east-1" },
      },
    });

    const fetched = await clients.executionContextQuery.getByExecutionId({ executionId });
    const secretEntry = fetched.spec?.data?.AWS_SECRET_ACCESS_KEY;

    expect(secretEntry?.isSecret, "is_secret is preserved on read in both editions").toBe(true);
    expect(fetched.spec?.data?.AWS_REGION?.value, "plaintext values are never redacted").toBe("us-east-1");

    if (target.capabilities.secretRedaction) {
      expect(secretEntry?.value, "redacting targets must not return the plaintext secret to a user token").not.toBe(
        secretValue,
      );
      return;
    }

    expect(secretEntry?.value, "OSS returns the secret value in plaintext").toBe(secretValue);
  });
});

describe("ExecutionContext conformance — negative paths", () => {
  it("rejects a wrong api_version (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.executionContextCommand.create({
          apiVersion: "wrong.stigmer.ai/v1",
          kind: EXECUTION_CONTEXT_KIND,
          metadata: { name: uniqueName("ectx"), org },
          spec: makeExecutionContextSpec(),
        }),
      Code.InvalidArgument,
      "create with wrong api_version",
    );
  });

  it("rejects a wrong kind (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.executionContextCommand.create({
          apiVersion: EXECUTION_CONTEXT_API_VERSION,
          kind: "NotAnExecutionContext",
          metadata: { name: uniqueName("ectx"), org },
          spec: makeExecutionContextSpec(),
        }),
      Code.InvalidArgument,
      "create with wrong kind",
    );
  });

  it("rejects an empty execution_id (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // spec.execution_id has min_len=1; an empty value fails Layer-1 protovalidate.
    await expectGrpcCode(
      () =>
        clients.executionContextCommand.create({
          apiVersion: EXECUTION_CONTEXT_API_VERSION,
          kind: EXECUTION_CONTEXT_KIND,
          metadata: { name: uniqueName("ectx"), org },
          spec: { executionId: "", data: {} },
        }),
      Code.InvalidArgument,
      "create with empty execution_id",
    );
  });

  it("rejects a create with no metadata (InvalidArgument)", async () => {
    // metadata is required=true at the proto level.
    await expectGrpcCode(
      () =>
        clients.executionContextCommand.create({
          apiVersion: EXECUTION_CONTEXT_API_VERSION,
          kind: EXECUTION_CONTEXT_KIND,
          spec: makeExecutionContextSpec(),
        }),
      Code.InvalidArgument,
      "create without metadata",
    );
  });

  it("rejects a duplicate create (contract: AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("dup");
    await createExecutionContext(org, name);

    // create's duplicate check is the shared CheckDuplicateStep, which returns a
    // typed AlreadyExists on every target.
    await expectGrpcCode(
      () => clients.executionContextCommand.create(makeExecutionContext({ org, name })),
      Code.AlreadyExists,
      "duplicate create",
    );
  });

  it("rejects a create with no name (contract: InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.executionContextCommand.create({
          apiVersion: EXECUTION_CONTEXT_API_VERSION,
          kind: EXECUTION_CONTEXT_KIND,
          metadata: { org },
          spec: makeExecutionContextSpec(),
        }),
      Code.InvalidArgument,
      "create without name",
    );
  });
});
