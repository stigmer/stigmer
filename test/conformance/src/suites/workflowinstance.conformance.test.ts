// Conformance suite for the WorkflowInstance domain.
// Domain: agentic / workflowinstance — the "Instance" layer of the Template ->
// Instance -> Execution pattern: binds a Workflow template (spec.workflow_id)
// to an ordered list of Environment refs merged at execution start.
//
// Drives WorkflowInstanceCommandController + WorkflowInstanceQueryController
// through the raw proto stubs and asserts the contract: CRUD round-trips,
// apply create/update branching, parent-workflow validation (unknown ->
// NotFound, cross-org -> InvalidArgument), getByWorkflow listing incl. the
// auto-provisioned default instance and org scoping, the visibility matrix
// (private/org/public; platform unsupported), the domain's dedicated
// execution-visibility axis (updateExecutionVisibility), and spec-first
// negative paths (environment_refs kind is CEL-pinned to environment).
//
// Deliberately NOT asserted, with rulings pending or taken:
//   - spec.workflow_id immutability on update: the proto docs claim it, but
//     NEITHER edition enforces it (generic full-spec-replacement update) —
//     stigmer#646 holds the enforce-vs-truth-the-docs ruling. Only genuinely
//     mutable fields (description, environment_refs) are updated here.
//   - execution cascade on instance delete: the command.proto comment claims
//     it, but OSS deliberately does not cascade executions (the #582 ruling:
//     run history survives its instance).
//
// The parent Workflow's default-instance machinery (provisioning, the
// updateVisibility guard, delete cascade) is asserted from the Workflow
// domain's suite; here the default instance only appears as a required
// member of getByWorkflow results.
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { makeWorkflow } from "../support/workflows";
import {
  WORKFLOW_INSTANCE_API_VERSION,
  WORKFLOW_INSTANCE_KIND,
  makeWorkflowInstance,
  makeWorkflowInstanceSpec,
} from "../support/workflowinstances";
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

// A parent Workflow template for instances to bind to. Its delete (deferred)
// cascades to all remaining instances — FixtureTracker runs cleanups in
// reverse order, so instances deferred later delete first and the cascade
// only mops up whatever a test intentionally left behind.
async function provisionWorkflow(org: string) {
  const workflow = await clients.workflowCommand.create(makeWorkflow({ org, name: uniqueName("wfl") }));
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
  return workflow;
}

async function createInstance(org: string, workflowId: string, name: string) {
  const instance = await clients.workflowInstanceCommand.create(
    makeWorkflowInstance({ org, name, workflowId }),
  );
  fixtures.defer(() => clients.workflowInstanceCommand.delete({ value: instance.metadata!.id }));
  return instance;
}

describe("WorkflowInstance conformance — CRUD & identity", () => {
  it("create assigns a win_ id, echoes the spec, and records a created audit event", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    const name = uniqueName("wfi");

    const created = await createInstance(org, workflow.metadata!.id, name);

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^win_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.workflowId).toBe(workflow.metadata?.id);
    expect(created.spec?.description).toBe("conformance fixture");
    expect(created.status?.audit?.specAudit?.event).toBe("created");
    // Instances are not blueprint kinds: unspecified visibility defaults to
    // private — explicitly persisted, never the proto zero value.
    expect(created.metadata?.visibility, "visibility defaults to private").toBe(
      ApiResourceVisibility.visibility_private,
    );
  });

  it("get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    const created = await createInstance(org, workflow.metadata!.id, uniqueName("wfi"));

    const fetched = await clients.workflowInstanceQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    assertResourceParity(WorkflowInstanceSchema, created, fetched, "create vs get");
  });

  it("apply creates on first call and updates on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    const name = uniqueName("wfi");

    const first = await clients.workflowInstanceCommand.apply(
      makeWorkflowInstance({ org, name, workflowId: workflow.metadata!.id, description: "v1" }),
    );
    fixtures.defer(() => clients.workflowInstanceCommand.delete({ value: first.metadata!.id }));
    expect(first.status?.audit?.specAudit?.event).toBe("created");

    const second = await clients.workflowInstanceCommand.apply(
      makeWorkflowInstance({ org, name, workflowId: workflow.metadata!.id, description: "v2" }),
    );

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.spec?.description).toBe("v2");
    expect(second.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("update replaces mutable spec fields but preserves id, slug, and org", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    const created = await createInstance(org, workflow.metadata!.id, uniqueName("wfi"));
    const { id, slug } = created.metadata!;

    const renamed = uniqueName("renamed");
    // The same workflow_id is resubmitted: whether a DIFFERENT parent ref is
    // rejected is unpinned — the proto docs claim immutability but neither
    // edition enforces it (stigmer#646 holds that ruling).
    const updated = await clients.workflowInstanceCommand.update({
      apiVersion: WORKFLOW_INSTANCE_API_VERSION,
      kind: WORKFLOW_INSTANCE_KIND,
      // Attempts to mutate slug/org must be ignored; only name and spec change.
      metadata: { id, name: renamed, slug: "attempted-different-slug", org: "attempted-different-org" },
      spec: makeWorkflowInstanceSpec({ workflowId: workflow.metadata!.id, description: "after" }),
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
    const workflow = await provisionWorkflow(org);
    const created = await clients.workflowInstanceCommand.create(
      makeWorkflowInstance({ org, name: uniqueName("wfi"), workflowId: workflow.metadata!.id }),
    );
    const { id } = created.metadata!;

    const deleted = await clients.workflowInstanceCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.workflowInstanceQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("get of a missing id returns NotFound", () =>
    expectGrpcCode(
      () => clients.workflowInstanceQuery.get({ value: "win_doesnotexist" }),
      Code.NotFound,
      "get missing id",
    ));

  it("getByReference resolves by org and slug", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    const created = await createInstance(org, workflow.metadata!.id, uniqueName("ref"));

    const fetched = await clients.workflowInstanceQuery.getByReference({ org, slug: created.metadata!.slug });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
  });

  it("getByReference of an unknown slug returns NotFound", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.workflowInstanceQuery.getByReference({ org, slug: "does-not-exist" }),
      Code.NotFound,
      "getByReference unknown slug",
    );
  });

  it("getByReference rejects a kind that does not match the service", () =>
    expectGrpcCode(
      () =>
        clients.workflowInstanceQuery.getByReference({ org: "acme", slug: "any", kind: ApiResourceKind.agent }),
      Code.InvalidArgument,
      "getByReference kind mismatch",
    ));

  it("derives a slug from the name and allows the same slug in different orgs", async () => {
    const a = await target.provisionTenancy();
    const b = await target.provisionTenancy();
    const workflowA = await provisionWorkflow(a.org);
    const workflowB = await provisionWorkflow(b.org);
    const name = uniqueName("shared");

    const inA = await createInstance(a.org, workflowA.metadata!.id, name);
    const inB = await createInstance(b.org, workflowB.metadata!.id, name);

    expect(inA.metadata?.slug).toBe(name);
    expect(inA.metadata?.slug).toBe(inB.metadata?.slug);
    expect(inA.metadata?.id).not.toBe(inB.metadata?.id);
  });
});

describe("WorkflowInstance conformance — getByWorkflow", () => {
  it("returns the created instances AND the workflow's auto-provisioned default instance", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    const a = await createInstance(org, workflow.metadata!.id, uniqueName("wfi"));
    const b = await createInstance(org, workflow.metadata!.id, uniqueName("wfi"));

    const list = await clients.workflowInstanceQuery.getByWorkflow({ workflowId: workflow.metadata!.id });

    const ids = list.entries.map((entry) => entry.metadata?.id);
    // arrayContaining, never exact counts: the parent's default instance
    // (status.default_instance_id) is always a member of the result set.
    expect(ids).toEqual(expect.arrayContaining([a.metadata?.id, b.metadata?.id]));
    expect(ids, "the default instance is listed alongside user instances").toContain(
      workflow.status?.defaultInstanceId,
    );
  });

  it("scopes results to the requested org (a foreign org sees nothing)", async () => {
    const { org } = await target.provisionTenancy();
    const other = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    await createInstance(org, workflow.metadata!.id, uniqueName("wfi"));

    const foreign = await clients.workflowInstanceQuery.getByWorkflow({
      workflowId: workflow.metadata!.id,
      org: other.org,
    });

    expect(foreign.entries, "instances all live in the parent's org").toEqual([]);
  });

  it("rejects an empty workflow_id (InvalidArgument)", () =>
    expectGrpcCode(
      () => clients.workflowInstanceQuery.getByWorkflow({ workflowId: "" }),
      Code.InvalidArgument,
      "getByWorkflow empty workflow_id",
    ));
});

describe("WorkflowInstance conformance — visibility", () => {
  it("updateVisibility raises a user instance from private to org and persists it", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    const created = await createInstance(org, workflow.metadata!.id, uniqueName("wfi"));

    const updated = await clients.workflowInstanceCommand.updateVisibility({
      resourceId: created.metadata!.id,
      visibility: ApiResourceVisibility.visibility_org,
    });
    expect(updated.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);

    const stored = await clients.workflowInstanceQuery.get({ value: created.metadata!.id });
    expect(stored.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
  });

  it("updateVisibility rejects the unsupported platform level (InvalidArgument) and leaves the stored level untouched", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    const created = await createInstance(org, workflow.metadata!.id, uniqueName("wfi"));

    const err = await expectGrpcCode(
      () =>
        clients.workflowInstanceCommand.updateVisibility({
          resourceId: created.metadata!.id,
          visibility: ApiResourceVisibility.visibility_platform,
        }),
      Code.InvalidArgument,
      "updateVisibility to platform",
    );
    // Both editions build the rejection from the kind's proto visibility
    // config; the stable fragment is part of the cross-edition contract.
    expect(err.message).toContain("cannot be set to visibility_platform");

    const stored = await clients.workflowInstanceQuery.get({ value: created.metadata!.id });
    expect(stored.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
  });
});

describe("WorkflowInstance conformance — execution visibility", () => {
  // Execution visibility is the domain's second, independent axis: who can
  // observe this instance's run history (private = triggerer only,
  // organization = all members). It is deliberately distinct from resource
  // visibility and has its own dedicated write RPC.
  it("updateExecutionVisibility sets organization and resets to private", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    const created = await createInstance(org, workflow.metadata!.id, uniqueName("wfi"));

    const raised = await clients.workflowInstanceCommand.updateExecutionVisibility({
      resourceId: created.metadata!.id,
      executionVisibility: WorkflowExecutionVisibility.organization,
    });
    expect(raised.spec?.executionVisibility).toBe(WorkflowExecutionVisibility.organization);

    const lowered = await clients.workflowInstanceCommand.updateExecutionVisibility({
      resourceId: created.metadata!.id,
      executionVisibility: WorkflowExecutionVisibility.private,
    });
    expect(lowered.spec?.executionVisibility).toBe(WorkflowExecutionVisibility.private);
  });

  it("rejects the unspecified zero value (InvalidArgument, protovalidate not_in)", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    const created = await createInstance(org, workflow.metadata!.id, uniqueName("wfi"));

    await expectGrpcCode(
      () =>
        clients.workflowInstanceCommand.updateExecutionVisibility({
          resourceId: created.metadata!.id,
          executionVisibility: WorkflowExecutionVisibility.unspecified,
        }),
      Code.InvalidArgument,
      "updateExecutionVisibility zero value",
    );
  });

  it("returns NotFound for an unknown instance id", () =>
    expectGrpcCode(
      () =>
        clients.workflowInstanceCommand.updateExecutionVisibility({
          resourceId: "win_doesnotexist",
          executionVisibility: WorkflowExecutionVisibility.private,
        }),
      Code.NotFound,
      "updateExecutionVisibility unknown id",
    ));
});

describe("WorkflowInstance conformance — negative paths", () => {
  it("rejects a wrong api_version (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    await expectGrpcCode(
      () =>
        clients.workflowInstanceCommand.create({
          apiVersion: "wrong.stigmer.ai/v1",
          kind: WORKFLOW_INSTANCE_KIND,
          metadata: { name: uniqueName("wfi"), org },
          spec: makeWorkflowInstanceSpec({ workflowId: workflow.metadata!.id }),
        }),
      Code.InvalidArgument,
      "create with wrong api_version",
    );
  });

  it("rejects a wrong kind (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    await expectGrpcCode(
      () =>
        clients.workflowInstanceCommand.create({
          apiVersion: WORKFLOW_INSTANCE_API_VERSION,
          kind: "NotAWorkflowInstance",
          metadata: { name: uniqueName("wfi"), org },
          spec: makeWorkflowInstanceSpec({ workflowId: workflow.metadata!.id }),
        }),
      Code.InvalidArgument,
      "create with wrong kind",
    );
  });

  it("rejects a duplicate create (contract: AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    const name = uniqueName("dup");
    await createInstance(org, workflow.metadata!.id, name);

    await expectGrpcCode(
      () =>
        clients.workflowInstanceCommand.create(
          makeWorkflowInstance({ org, name, workflowId: workflow.metadata!.id }),
        ),
      Code.AlreadyExists,
      "duplicate create",
    );
  });

  it("rejects a create with no name (contract: InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);
    await expectGrpcCode(
      () =>
        clients.workflowInstanceCommand.create({
          apiVersion: WORKFLOW_INSTANCE_API_VERSION,
          kind: WORKFLOW_INSTANCE_KIND,
          metadata: { org },
          spec: makeWorkflowInstanceSpec({ workflowId: workflow.metadata!.id }),
        }),
      Code.InvalidArgument,
      "create without name",
    );
  });

  it("rejects an unknown workflow_id (contract: NotFound from parent load)", async () => {
    // The parent template must exist: create runs LoadParentWorkflow before
    // persisting. (AgentInstance diverges here — OSS skips the parent load
    // while cloud rejects; stigmer#645 holds that ruling, so the agent-side
    // suite deliberately leaves this unasserted.)
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.workflowInstanceCommand.create(
          makeWorkflowInstance({ org, name: uniqueName("wfi"), workflowId: "wfl_doesnotexist" }),
        ),
      Code.NotFound,
      "create with unknown workflow_id",
    );
  });

  it("rejects a parent workflow from a different org (InvalidArgument)", async () => {
    const a = await target.provisionTenancy();
    const b = await target.provisionTenancy();
    const foreignWorkflow = await provisionWorkflow(b.org);

    await expectGrpcCode(
      () =>
        clients.workflowInstanceCommand.create(
          makeWorkflowInstance({ org: a.org, name: uniqueName("wfi"), workflowId: foreignWorkflow.metadata!.id }),
        ),
      Code.InvalidArgument,
      "create with cross-org parent",
    );
  });

  it("rejects environment_refs whose kind is not environment (InvalidArgument, CEL-pinned)", async () => {
    const { org } = await target.provisionTenancy();
    const workflow = await provisionWorkflow(org);

    await expectGrpcCode(
      () =>
        clients.workflowInstanceCommand.create({
          apiVersion: WORKFLOW_INSTANCE_API_VERSION,
          kind: WORKFLOW_INSTANCE_KIND,
          metadata: { name: uniqueName("wfi"), org },
          spec: {
            workflowId: workflow.metadata!.id,
            description: "bad ref kind",
            environmentRefs: [{ org, slug: "some-env", kind: ApiResourceKind.agent }],
          },
        }),
      Code.InvalidArgument,
      "create with wrong-kind environment ref",
    );
  });
});
