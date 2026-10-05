// Conformance suite for a workflow's run visibility (Class B): who may
// observe a workflow's runs.
// Domain: agentic / workflowexecution — the read side of the workflow's
// `spec.execution_visibility`.
//
// A run is its person's: whoever started it reads it, and a workflow being
// visible to the organization (who may see and run it) exposes nobody's
// runs. The workflow's owner opts the organization in with
// updateExecutionVisibility, and the level reaches every run of the
// workflow, past runs included, until it is set back. Pinned on the
// target's ENFORCING EXECUTION LANE with the founder (the workflow's owner,
// who starts the run), a member of the founder's organization (who can see
// and run the workflow) and a member of another organization:
//
//   - PRIVATE (the level a workflow starts at): the member is refused the
//     founder's run by get, and listByWorkflow leaves it out;
//   - ORGANIZATION: the member reads the run started before the change and
//     lists it; the other organization's member is still refused;
//   - back to PRIVATE: the member is refused again.
//
// Lists are asked the same question a get is, so listByWorkflow shows the
// member exactly the runs a get would read. Who may change the level, how
// update and apply keep it, and that a toggle is no new version are the
// workflow suite's (suites/workflow.conformance.test.ts). Where the target
// lends no enforcing lane the arm skips VISIBLY with its reason.
import { Code } from "@connectrpc/connect";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { makeWorkflowExecution } from "../support/workflowexecutions";
import { makeWorkflow } from "../support/workflows";
import { createTarget, enforcingLaneOf, type EnforcingLane, type TargetProfile } from "../targets";

let target: TargetProfile;
let enforcing: Awaited<ReturnType<typeof enforcingLaneOf>>;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  enforcing = await enforcingLaneOf(target);
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

function laneOrSkip(ctx: { skip: (note?: string) => never }): EnforcingLane {
  if (enforcing.lane === undefined) ctx.skip(enforcing.reason);
  return enforcing.lane;
}

// Whether `reader` reads `runId` by get and finds it in the workflow's list.
async function expectReads(reader: ConformanceClients, workflowId: string, runId: string, who: string) {
  const read = await reader.workflowExecutionQuery.get({ value: runId });
  expect(read.metadata?.id, `${who} reads the run`).toBe(runId);
  const listed = await reader.workflowExecutionQuery.listByWorkflow({ workflowId });
  expect(listed.entries.map((entry) => entry.metadata?.id), `${who} lists the run`).toContain(runId);
}

// Whether `reader` is refused `runId` by get and, where `listsWorkflow`
// (the reader can see the workflow), finds it absent from the workflow's list.
async function expectRefused(
  reader: ConformanceClients,
  workflowId: string,
  runId: string,
  who: string,
  listsWorkflow = true,
) {
  await expectGrpcCode(
    () => reader.workflowExecutionQuery.get({ value: runId }),
    Code.PermissionDenied,
    `${who} reads the run`,
  );
  if (!listsWorkflow) {
    return;
  }
  const listed = await reader.workflowExecutionQuery.listByWorkflow({ workflowId });
  expect(listed.entries.map((entry) => entry.metadata?.id), `${who} lists the run`).not.toContain(runId);
}

describe("WorkflowExecution run visibility — who observes a workflow's runs (on the enforcing execution lane)", () => {
  it("[rpc:WorkflowExecutionQueryController.get] [rpc:WorkflowExecutionQueryController.listByWorkflow] a teammate is refused a PRIVATE workflow's run, reads it once the owner opens the runs to the organization, and loses it when they are closed again", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const home = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(home));
    const elsewhere = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(elsewhere));
    const teammate = await lane.provisionMember(home);
    const stranger = await lane.provisionMember(elsewhere);
    const founder = lane.clients;

    // Org-visible (the blueprint default): the teammate may see and run it.
    const workflow = await founder.workflowCommand.create(
      makeWorkflow({ org: home.org, name: uniqueName("wf-run-audience") }),
    );
    const workflowId = workflow.metadata!.id;
    fixtures.defer(() => founder.workflowCommand.delete({ value: workflowId }));
    expect((await teammate.workflowQuery.get({ value: workflowId })).metadata?.id, "the teammate sees the workflow").toBe(
      workflowId,
    );

    const run = await founder.workflowExecutionCommand.create(
      makeWorkflowExecution({ org: home.org, name: uniqueName("founder-run"), workflowId }),
    );
    const runId = run.metadata!.id;
    fixtures.defer(() => founder.workflowExecutionCommand.delete({ value: runId }));

    await expectReads(founder, workflowId, runId, "the run's own person");
    await expectRefused(teammate, workflowId, runId, "a teammate, while the runs are private,");

    await founder.workflowCommand.updateExecutionVisibility({
      resourceId: workflowId,
      executionVisibility: WorkflowExecutionVisibility.organization,
    });
    await expectReads(teammate, workflowId, runId, "a teammate, once the runs are the organization's,");
    await expectRefused(stranger, workflowId, runId, "another organization's member", false);

    await founder.workflowCommand.updateExecutionVisibility({
      resourceId: workflowId,
      executionVisibility: WorkflowExecutionVisibility.private,
    });
    await expectRefused(teammate, workflowId, runId, "a teammate, once the runs are private again,");
  });
});
