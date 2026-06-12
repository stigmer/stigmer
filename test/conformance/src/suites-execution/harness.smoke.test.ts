// Execution-engine harness smoke test (Class B).
// Domain: agentic / workflowexecution — proves the engine is wired, not the
// domain contract.
//
// This is deliberately a `.smoke.test.ts`, not a `.conformance.test.ts`: it is
// the cheap, permanent guard that the local-go-execution target (Go server +
// Temporal + TS runner) actually runs an execution end-to-end. The whole
// WorkflowExecution domain contract (negatives, version pinning, signals,
// env-merge, create-boundary F7/F8) lands later as its own *.conformance suite,
// per DD-006 (a domain enters the suite whole).
//
// The vehicle is a data-only `set_vars` workflow: it runs through the runner's
// executeFromExecution path with no LLM, MCP, API key, proxy, object storage,
// or checkpointer service (jq runs in-process; the only egress is gRPC back to
// the server). So a green run isolates exactly one thing — the engine plumbing.
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { makeWorkflow } from "../support/workflows";
import { createTarget, type TargetProfile } from "../targets";

const WORKFLOW_EXECUTION_API_VERSION = "agentic.stigmer.ai/v1";
const WORKFLOW_EXECUTION_KIND = "WorkflowExecution";

// A data-only set_vars run is sub-second once picked up; the headroom absorbs
// first-run Temporal/runner warmup, not steady-state latency.
const COMPLETION_TIMEOUT_MS = 60_000;
const COMPLETION_POLL_MS = 250;

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

    // Blueprint: a single set_vars task. create returns the wfl_ id the
    // execution references; the server resolves the default instance from it.
    const workflow = await clients.workflowCommand.create(
      makeWorkflow({ org, name: uniqueName("wf-smoke"), taskVar: "hello" }),
    );
    fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));

    const execution = await clients.workflowExecutionCommand.create({
      apiVersion: WORKFLOW_EXECUTION_API_VERSION,
      kind: WORKFLOW_EXECUTION_KIND,
      metadata: { name: uniqueName("wfx-smoke"), org },
      spec: { workflowId: workflow.metadata!.id },
    });
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

    const finalPhase = await waitForTerminalPhase(executionId);
    expect(
      finalPhase,
      `execution ${executionId} should complete; reached ${ExecutionPhase[finalPhase]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });
});

// Polls get until the execution leaves the non-terminal phases (PENDING /
// IN_PROGRESS), returning whatever terminal phase it settles in so the caller
// can assert success with a diagnostic on failure.
async function waitForTerminalPhase(executionId: string): Promise<ExecutionPhase> {
  const deadline = Date.now() + COMPLETION_TIMEOUT_MS;
  let lastPhase = ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  while (Date.now() < deadline) {
    const current = await clients.workflowExecutionQuery.get({ value: executionId });
    lastPhase = current.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
    if (
      lastPhase !== ExecutionPhase.EXECUTION_PENDING &&
      lastPhase !== ExecutionPhase.EXECUTION_IN_PROGRESS &&
      lastPhase !== ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED
    ) {
      return lastPhase;
    }
    await delay(COMPLETION_POLL_MS);
  }
  throw new Error(
    `execution ${executionId} did not reach a terminal phase within ${COMPLETION_TIMEOUT_MS}ms ` +
      `(last observed: ${ExecutionPhase[lastPhase]})`,
  );
}
