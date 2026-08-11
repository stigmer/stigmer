// Conformance suite for the Workflow domain.
// Domain: agentic / workflow — the first VERSIONED resource in the suite.
//
// Drives WorkflowCommandController + WorkflowQueryController through the raw
// proto stubs and asserts the contract: CRUD round-trips, apply create/update
// branching, immutable identity fields, slug semantics, spec-first negative
// paths, and — the surface that makes this domain distinct — version history
// (listVersions / getVersion / getByReference resolution by hash and tag) and
// the validateSpec endpoint.
//
// One deliberate, recorded boundary remains for the local-go target (see the
// project plan's "Findings to file"):
//   - validateSpec discards its structured result on structurally-invalid specs
//     (returns an error instead of state=INVALID). This session asserts only the
//     clean contract (VALID result; Layer-1 proto failures → InvalidArgument);
//     the Layer-2 error-vs-result question is filed, not encoded here.
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { WORKFLOW_API_VERSION, WORKFLOW_KIND, makeWorkflow, makeWorkflowSpec } from "../support/workflows";
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

interface CreateOptions {
  taskVar?: string;
  variables?: Record<string, string>;
  tag?: string;
  documentName?: string;
}

async function createWorkflow(org: string, name: string, opts: CreateOptions = {}) {
  const workflow = await clients.workflowCommand.create(makeWorkflow({ org, name, ...opts }));
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
  return workflow;
}

// Apply and register cleanup once for the resource the apply targets. Repeated
// applies of the same name address the same resource, so the caller defers only
// the first one.
async function applyWorkflow(org: string, name: string, opts: CreateOptions = {}, track = true) {
  const workflow = await clients.workflowCommand.apply(makeWorkflow({ org, name, ...opts }));
  if (track) {
    fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
  }
  return workflow;
}

describe("Workflow conformance — CRUD & identity", () => {
  it("create assigns a wfl_ id, echoes the spec, records a created audit event, and sets version + default instance", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("wf");

    const created = await createWorkflow(org, name, { taskVar: "hello" });

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^wfl_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.document?.dsl).toBe("1.0.0");
    expect(created.spec?.tasks).toHaveLength(1);
    expect(created.status?.audit?.specAudit?.event).toBe("created");
    expect(created.status?.versionHash, "create computes a content version hash").toMatch(/^[a-f0-9]{64}$/);
    expect(created.status?.defaultInstanceId, "create provisions a default instance").toMatch(/^win_[0-9a-z]+$/);
  });

  it("get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createWorkflow(org, uniqueName("wf"));

    const fetched = await clients.workflowQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    assertResourceParity(WorkflowSchema, created, fetched, "create vs get");
  });

  it("update replaces spec and name but preserves id, slug, and org", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createWorkflow(org, uniqueName("wf"), { taskVar: "before" });
    const { id, slug } = created.metadata!;

    const renamed = uniqueName("renamed");
    const updated = await clients.workflowCommand.update({
      apiVersion: WORKFLOW_API_VERSION,
      kind: WORKFLOW_KIND,
      // Attempts to mutate slug/org must be ignored; only name and spec change.
      metadata: { id, name: renamed, slug: "attempted-different-slug", org: "attempted-different-org" },
      spec: makeWorkflowSpec({ namespace: org, documentName: renamed, taskVar: "after" }),
    });

    expect(updated.metadata?.id).toBe(id);
    expect(updated.metadata?.slug).toBe(slug);
    expect(updated.metadata?.org).toBe(org);
    expect(updated.metadata?.name).toBe(renamed);
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("delete returns the resource and a subsequent get reports NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const created = await clients.workflowCommand.create(makeWorkflow({ org, name: uniqueName("wf") }));
    const { id } = created.metadata!;

    const deleted = await clients.workflowCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.workflowQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.workflowQuery.get({ value: "" }), Code.InvalidArgument, "get empty id"));

  it("get of a missing id returns NotFound", () =>
    expectGrpcCode(() => clients.workflowQuery.get({ value: "wfl_doesnotexist" }), Code.NotFound, "get missing id"));

  it("derives a slug from the name", async () => {
    const { org } = await target.provisionTenancy();
    // The document name stays slug-clean; only metadata.name carries the
    // characters whose slug derivation is under test.
    const created = await createWorkflow(org, "My Workflow #1 (Test)", { documentName: "slug-derivation" });
    expect(created.metadata?.slug).toBe("my-workflow-1-test");
  });

  it("allows the same slug in different orgs", async () => {
    const a = await target.provisionTenancy();
    const b = await target.provisionTenancy();
    const name = uniqueName("shared");

    const inA = await createWorkflow(a.org, name);
    const inB = await createWorkflow(b.org, name);

    expect(inA.metadata?.slug).toBe(inB.metadata?.slug);
    expect(inA.metadata?.id).not.toBe(inB.metadata?.id);
  });

  it("rejects a workflow without a spec (contract: InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.workflowCommand.create({
          apiVersion: WORKFLOW_API_VERSION,
          kind: WORKFLOW_KIND,
          metadata: { name: uniqueName("nospec"), org },
        }),
      Code.InvalidArgument,
      "create without spec",
    );
  });

  it("rejects a duplicate create (contract: AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("dup");
    await createWorkflow(org, name);

    await expectGrpcCode(
      () => clients.workflowCommand.create(makeWorkflow({ org, name })),
      Code.AlreadyExists,
      "duplicate create",
    );
  });

  it("rejects a create with no name (contract: InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // Spec is valid so Layer 1/2 pass; the empty name is what must be rejected
    // (slug resolution has nothing to derive from).
    await expectGrpcCode(
      () =>
        clients.workflowCommand.create({
          apiVersion: WORKFLOW_API_VERSION,
          kind: WORKFLOW_KIND,
          metadata: { org },
          spec: makeWorkflowSpec({ namespace: org }),
        }),
      Code.InvalidArgument,
      "create without name",
    );
  });
});

describe("Workflow conformance — version history", () => {
  it("apply creates on first call and updates on second (same name)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("wf");

    const first = await applyWorkflow(org, name, { taskVar: "v1" });
    expect(first.status?.audit?.specAudit?.event).toBe("created");

    const second = await applyWorkflow(org, name, { taskVar: "v2" }, false);
    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("an idempotent apply (identical spec) does not archive a new version", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("wf");

    const created = await applyWorkflow(org, name, { taskVar: "same" });
    await applyWorkflow(org, name, { taskVar: "same" }, false);

    const history = await clients.workflowQuery.listVersions({ org, slug: created.metadata!.slug });
    expect(history.versions, "re-applying the same spec must not create a version").toHaveLength(1);
    expect(history.totalCount).toBe(1);
  });

  it("an idempotent apply is order-agnostic: permuted task-config key order registers no version", async () => {
    // Protobuf map entry order carries no meaning, and real SDKs vary it (Go
    // randomizes proto map marshal order per apply). protobuf-es serializes
    // Struct fields in object insertion order, so these two applies reproduce
    // that wire variance deliberately — the single-key test above can never
    // exercise it, which is exactly how stigmer/stigmer#341 shipped: the
    // cloud engine hashed wire-ordered YAML, so every SDK re-apply registered
    // a phantom version. Both editions must render canonical (key-sorted)
    // YAML so version identity is a pure function of the spec.
    const { org } = await target.provisionTenancy();
    const name = uniqueName("wf");

    const created = await applyWorkflow(org, name, { variables: { alpha: "1", beta: "2", gamma: "3" } });
    await applyWorkflow(org, name, { variables: { gamma: "3", beta: "2", alpha: "1" } }, false);

    const history = await clients.workflowQuery.listVersions({ org, slug: created.metadata!.slug });
    expect(history.versions, "map key order on the wire must not affect version identity").toHaveLength(1);
    expect(history.totalCount).toBe(1);
  });

  it("re-applying a prior version's spec repoints the head without a duplicate row (A→B→A)", async () => {
    // Content-addressed identity: one content, one history entry. A rollback
    // apply reproduces the archived version's hash (canonical rendering), so
    // the head repoints to the existing row instead of appending a duplicate
    // — which would give the single-holder tag primitive two targets and
    // make hash lookups ambiguous. Recency and currency legitimately diverge
    // here: the newest-archived row is B, the current version is A.
    const { org } = await target.provisionTenancy();
    const name = uniqueName("wf");

    const vA = await applyWorkflow(org, name, { taskVar: "a" });
    const vB = await applyWorkflow(org, name, { taskVar: "b" }, false);
    expect(vB.status?.versionHash).not.toBe(vA.status?.versionHash);

    const rolledBack = await applyWorkflow(org, name, { taskVar: "a" }, false);
    expect(rolledBack.status?.versionHash, "rollback must repoint the head to the archived version's hash").toBe(
      vA.status?.versionHash,
    );

    const history = await clients.workflowQuery.listVersions({ org, slug: vA.metadata!.slug });
    expect(history.versions, "rollback must not append a duplicate history row").toHaveLength(2);
    expect(history.totalCount).toBe(2);
    expect(history.versions[0]?.versionHash, "history stays newest-archived-first").toBe(vB.status?.versionHash);

    const current = history.versions.filter((entry) => entry.isCurrent);
    expect(current, "exactly one version is current").toHaveLength(1);
    expect(current[0]?.versionHash, "the repointed-to entry is current").toBe(vA.status?.versionHash);
  });

  it("applying a changed spec archives a new version (newest-first, exactly one current)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("wf");

    const v1 = await applyWorkflow(org, name, { taskVar: "v1" });
    const v2 = await applyWorkflow(org, name, { taskVar: "v2" }, false);
    expect(v2.status?.versionHash).not.toBe(v1.status?.versionHash);

    const history = await clients.workflowQuery.listVersions({ org, slug: v1.metadata!.slug });
    expect(history.versions).toHaveLength(2);
    expect(history.totalCount).toBe(2);

    // Newest first; the head is current and matches the live workflow's hash.
    expect(history.versions[0]?.isCurrent).toBe(true);
    expect(history.versions[0]?.versionHash).toBe(v2.status?.versionHash);
    expect(history.versions.filter((entry) => entry.isCurrent)).toHaveLength(1);
    for (const entry of history.versions) {
      expect(entry.validatedYaml, "each version carries its executable YAML").not.toBe("");
    }
  });

  it("getVersion returns the current version by hash and an archived prior version", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("wf");

    const v1 = await applyWorkflow(org, name, { taskVar: "v1" });
    const v2 = await applyWorkflow(org, name, { taskVar: "v2" }, false);
    const id = v1.metadata!.id;

    const current = await clients.workflowQuery.getVersion({ workflowId: id, versionHash: v2.status!.versionHash });
    expect(current.isCurrent).toBe(true);
    expect(current.versionHash).toBe(v2.status?.versionHash);

    const prior = await clients.workflowQuery.getVersion({ workflowId: id, versionHash: v1.status!.versionHash });
    expect(prior.isCurrent).toBe(false);
    expect(prior.versionHash).toBe(v1.status?.versionHash);
    expect(prior.validatedYaml).not.toBe("");
  });

  it("getVersion rejects a malformed hash and reports a missing one as NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createWorkflow(org, uniqueName("wf"));
    const id = created.metadata!.id;

    // Contract: a hash violating the proto pattern is InvalidArgument, enforced
    // for every target by the transport-boundary protovalidate interceptor.
    await expectGrpcCode(
      () => clients.workflowQuery.getVersion({ workflowId: id, versionHash: "not-a-valid-hash" }),
      Code.InvalidArgument,
      "getVersion malformed hash",
    );
    // A well-formed but unknown hash is unambiguously NotFound everywhere.
    await expectGrpcCode(
      () => clients.workflowQuery.getVersion({ workflowId: id, versionHash: "0".repeat(64) }),
      Code.NotFound,
      "getVersion unknown hash",
    );
  });

  it("getByReference resolves latest, an exact hash, and an apply-time tag", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("wf");

    // v1 carries an apply-time tag; v2 (untagged) becomes the head.
    const v1 = await applyWorkflow(org, name, { taskVar: "v1", tag: "stable" });
    const v2 = await applyWorkflow(org, name, { taskVar: "v2" }, false);
    const slug = v1.metadata!.slug;

    const latest = await clients.workflowQuery.getByReference({ org, slug });
    expect(latest.status?.versionHash, "empty version resolves to the head").toBe(v2.status?.versionHash);

    const byHash = await clients.workflowQuery.getByReference({ org, slug, version: v1.status!.versionHash });
    expect(byHash.status?.versionHash, "a 64-hex version resolves to the exact archived version").toBe(
      v1.status?.versionHash,
    );

    const byTag = await clients.workflowQuery.getByReference({ org, slug, version: "stable" });
    expect(byTag.status?.versionHash, "a tag resolves to the version it was applied to").toBe(v1.status?.versionHash);
  });

  it("getByReference of an unknown slug returns NotFound", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.workflowQuery.getByReference({ org, slug: "does-not-exist" }),
      Code.NotFound,
      "getByReference unknown slug",
    );
  });

  it("getByReference rejects a kind that does not match the service", () =>
    expectGrpcCode(
      () => clients.workflowQuery.getByReference({ org: "acme", slug: "web-search", kind: ApiResourceKind.agent }),
      Code.InvalidArgument,
      "getByReference kind mismatch",
    ));
});

describe("Workflow conformance — validateSpec", () => {
  it("returns a VALID result with generated YAML and persists nothing", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("wf");

    const result = await clients.workflowCommand.validateSpec(makeWorkflow({ org, name }));

    expect(result.state).toBe(ValidationState.VALID);
    expect(result.yaml, "a valid spec yields generated CNCF YAML").not.toBe("");
    expect(result.errors).toHaveLength(0);

    // validateSpec has no side effects: nothing was persisted.
    await expectGrpcCode(
      () => clients.workflowQuery.getByReference({ org, slug: name }),
      Code.NotFound,
      "validateSpec must not persist a workflow",
    );
  });

  it("rejects Layer-1 proto violations with InvalidArgument", async () => {
    const { org } = await target.provisionTenancy();
    // Missing document (required) and empty tasks (min_items=1) are proto-level
    // constraint failures caught before any structural validation runs.
    await expectGrpcCode(
      () =>
        clients.workflowCommand.validateSpec({
          apiVersion: WORKFLOW_API_VERSION,
          kind: WORKFLOW_KIND,
          metadata: { name: uniqueName("wf"), org },
          spec: { tasks: [] },
        }),
      Code.InvalidArgument,
      "validateSpec Layer-1 violation",
    );
  });
});

describe("Workflow conformance — tagVersion", () => {
  it("is unavailable (Unimplemented) when version tagging is not a capability", async () => {
    if (target.capabilities.versionTagging) {
      // Version tagging is implemented on this target; the positive contract is
      // asserted below. This gate only covers targets that do not implement it.
      return;
    }
    const { org } = await target.provisionTenancy();
    const created = await createWorkflow(org, uniqueName("wf"));

    await expectGrpcCode(
      () =>
        clients.workflowCommand.tagVersion({
          workflowId: created.metadata!.id,
          versionHash: created.status!.versionHash,
          tag: "stable",
        }),
      Code.Unimplemented,
      "tagVersion unimplemented",
    );
  });

  it("assigns a tag to a version and resolves it through getByReference", async () => {
    if (!target.capabilities.versionTagging) return;
    const { org } = await target.provisionTenancy();
    const name = uniqueName("wf");

    const created = await createWorkflow(org, name);
    const { id, slug } = created.metadata!;

    await clients.workflowCommand.tagVersion({ workflowId: id, versionHash: created.status!.versionHash, tag: "stable" });

    const byTag = await clients.workflowQuery.getByReference({ org, slug, version: "stable" });
    expect(byTag.status?.versionHash, "the tag must resolve to the version it was assigned to").toBe(
      created.status?.versionHash,
    );
  });

  it("moves a tag to a new version, clearing the prior holder (single-holder)", async () => {
    if (!target.capabilities.versionTagging) return;
    const { org } = await target.provisionTenancy();
    const name = uniqueName("wf");

    const v1 = await applyWorkflow(org, name, { taskVar: "v1" });
    const v2 = await applyWorkflow(org, name, { taskVar: "v2" }, false);
    const { id, slug } = v1.metadata!;
    expect(v2.status?.versionHash).not.toBe(v1.status?.versionHash);

    await clients.workflowCommand.tagVersion({ workflowId: id, versionHash: v1.status!.versionHash, tag: "stable" });
    // Move the tag to the head.
    await clients.workflowCommand.tagVersion({ workflowId: id, versionHash: v2.status!.versionHash, tag: "stable" });

    const byTag = await clients.workflowQuery.getByReference({ org, slug, version: "stable" });
    expect(byTag.status?.versionHash, "the tag must move to the new target").toBe(v2.status?.versionHash);

    // v1 is still addressable by its immutable hash, but no longer by the moved tag.
    const byHash = await clients.workflowQuery.getByReference({ org, slug, version: v1.status!.versionHash });
    expect(byHash.status?.versionHash).toBe(v1.status?.versionHash);

    // The moved tag no longer appears on v1 in the version history.
    const history = await clients.workflowQuery.listVersions({ org, slug });
    const v1Entry = history.versions.find((entry) => entry.versionHash === v1.status?.versionHash);
    const v2Entry = history.versions.find((entry) => entry.versionHash === v2.status?.versionHash);
    expect(v2Entry?.tag, "the head must hold the moved tag").toBe("stable");
    expect(v1Entry?.tag, "the prior holder must be cleared").toBe("");
  });

  it("reports a well-formed but unknown version hash as NotFound", async () => {
    if (!target.capabilities.versionTagging) return;
    const { org } = await target.provisionTenancy();
    const created = await createWorkflow(org, uniqueName("wf"));

    await expectGrpcCode(
      () => clients.workflowCommand.tagVersion({ workflowId: created.metadata!.id, versionHash: "0".repeat(64), tag: "stable" }),
      Code.NotFound,
      "tagVersion unknown hash",
    );
  });

  it("rejects a malformed hash and an empty tag with InvalidArgument", async () => {
    if (!target.capabilities.versionTagging) return;
    const { org } = await target.provisionTenancy();
    const created = await createWorkflow(org, uniqueName("wf"));
    const id = created.metadata!.id;

    await expectGrpcCode(
      () => clients.workflowCommand.tagVersion({ workflowId: id, versionHash: "not-a-valid-hash", tag: "stable" }),
      Code.InvalidArgument,
      "tagVersion malformed hash",
    );
    await expectGrpcCode(
      () => clients.workflowCommand.tagVersion({ workflowId: id, versionHash: created.status!.versionHash, tag: "" }),
      Code.InvalidArgument,
      "tagVersion empty tag",
    );
  });
});
