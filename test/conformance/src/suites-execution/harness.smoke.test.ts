// Execution-engine harness smoke test (Class B).
// Domain: agentic / workflowexecution — proves the engine is wired, not the
// domain contract.
//
// This is deliberately a `.smoke.test.ts`, not a `.conformance.test.ts`: it is
// the cheap, permanent guard that the local-execution target (Go server +
// Temporal + TS runner) actually runs an execution end-to-end. The whole
// WorkflowExecution domain contract lives in workflowexecution.conformance.test.ts.
//
// The vehicle is a data-only `set_vars` workflow: it runs through the runner's
// executeFromExecution path with no LLM, MCP, API key, proxy, object storage,
// or checkpointer service (jq runs in-process; the only egress is gRPC back to
// the server). So a green run isolates exactly one thing — the engine plumbing.
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { awaitTerminal, makeWorkflowExecution } from "../support/workflowexecutions";
import { makeWorkflow } from "../support/workflows";
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

describe("Execution harness smoke — set_vars WorkflowExecution", () => {
  it("runs a data-only workflow end-to-end: PENDING at create, COMPLETED via the runner", async () => {
    const { org } = await target.provisionTenancy();

    const workflow = await clients.workflowCommand.create(
      makeWorkflow({ org, name: uniqueName("wf-smoke"), taskVar: "hello" }),
    );
    fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));

    const execution = await clients.workflowExecutionCommand.create(
      makeWorkflowExecution({ org, name: uniqueName("wfx-smoke"), workflowId: workflow.metadata!.id }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));

    // create persists then starts Temporal, so the response is PENDING. The
    // transition to COMPLETED proves the full path ran: Temporal dispatch ->
    // runner pickup -> hydration -> set_vars -> status streamed back via gRPC.
    // (We assert the deterministic endpoints, PENDING and COMPLETED, rather than
    // the sub-second IN_PROGRESS transient, which a poller cannot observe
    // reliably without introducing timing flake.)
    expect(execution.metadata?.id, "create assigns a prefixed execution id").toMatch(/^wex_[0-9a-z]+$/);
    expect(execution.status?.phase, "create returns a PENDING execution").toBe(
      ExecutionPhase.EXECUTION_PENDING,
    );

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `execution ${executionId} should complete; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });
});
