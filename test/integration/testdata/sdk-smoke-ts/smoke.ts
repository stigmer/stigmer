/**
 * SDK acceptance smoke test for @stigmer/sdk (TypeScript).
 *
 * Exercises Agent CRUD + error handling (Tier 1) and optionally
 * workflow execution lifecycle (Tier 2) against a local Stigmer
 * service running in test mode.
 *
 * Outputs a JSON result to stdout for the Go test orchestrator.
 * Diagnostic logs go to stderr.
 */

import { createGrpcTransport } from "@connectrpc/connect-node";
import { Stigmer, isNotFound } from "@stigmer/sdk";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ExecutionPhase, WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";

interface SmokeResult {
  tier1: "pass" | "fail" | "skip";
  tier2: "pass" | "fail" | "skip";
  errors: string[];
}

const result: SmokeResult = { tier1: "skip", tier2: "skip", errors: [] };

function log(msg: string): void {
  process.stderr.write(`[ts-smoke] ${msg}\n`);
}

function finish(exitCode: number): never {
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const addr = process.env.STIGMER_GRPC_ADDRESS;
  if (!addr) {
    result.errors.push("STIGMER_GRPC_ADDRESS not set");
    finish(1);
  }

  const workflowRunnerAvailable =
    process.env.STIGMER_WORKFLOW_RUNNER_AVAILABLE === "true";

  // connect-node v2's gRPC transport is HTTP/2-only; the v1-era httpVersion
  // option no longer exists.
  const transport = createGrpcTransport({
    baseUrl: `http://${addr}`,
  });

  const stigmer = new Stigmer({
    baseUrl: `http://${addr}`,
    customTransport: transport,
  });

  // -----------------------------------------------------------------------
  // Tier 1: Agent CRUD + error handling
  // -----------------------------------------------------------------------
  try {
    const agentName = `sdk-smoke-ts-${Date.now()}`;

    // Create
    log("creating agent...");
    const created = await stigmer.agent.apply({
      name: agentName,
      org: "test-org",
      description: "SDK acceptance smoke test agent (TypeScript)",
      instructions:
        "You are a test agent. Respond with exactly: hello from sdk smoke test",
    });

    const agentId = created.metadata?.id;
    if (!agentId) throw new Error("created agent has no ID");
    log(`created agent: id=${agentId}`);

    // Get
    log("fetching agent...");
    const fetched = await stigmer.agent.get(agentId);
    assertEqual("agent name", fetched.metadata?.name, agentName);
    assertEqual("agent org", fetched.metadata?.org, "test-org");
    assertEqual(
      "agent description",
      fetched.spec?.description,
      "SDK acceptance smoke test agent (TypeScript)",
    );

    // List
    log("listing agents...");
    const listResult = await stigmer.agent.list({ org: "test-org" });
    if (listResult.totalCount < 1) {
      throw new Error(
        `agent list must contain at least one entry, got ${listResult.totalCount}`,
      );
    }

    // Delete
    log("deleting agent...");
    await stigmer.agent.delete(agentId);

    // Get deleted -> NOT_FOUND
    log("verifying NOT_FOUND after delete...");
    try {
      await stigmer.agent.get(agentId);
      throw new Error("expected NOT_FOUND error but get succeeded");
    } catch (err) {
      if (!isNotFound(err)) {
        throw new Error(`expected NOT_FOUND error, got: ${err}`);
      }
    }

    log("Tier 1 passed");
    result.tier1 = "pass";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Tier 1 FAILED: ${msg}`);
    result.tier1 = "fail";
    result.errors.push(`tier1: ${msg}`);
    finish(1);
  }

  // -----------------------------------------------------------------------
  // Tier 2: Workflow execution lifecycle
  // -----------------------------------------------------------------------
  if (!workflowRunnerAvailable) {
    log("unified runner not available — skipping Tier 2");
    result.tier2 = "skip";
    finish(0);
  }

  try {
    const workflowName = `sdk-smoke-wf-ts-${Date.now()}`;

    // Apply workflow
    log("applying workflow...");
    const applied = await stigmer.workflow.apply({
      name: workflowName,
      org: "test-org",
      document: {
        dsl: "1.0.0",
        namespace: "test-org",
        name: workflowName,
        version: "1.0.0",
      },
      tasks: [
        {
          name: "setGreeting",
          kind: WorkflowTaskKind.set_vars,
          taskConfig: {
            variables: { greeting: "hello-from-ts-sdk-smoke-test" },
          },
        },
      ],
    });

    const workflowId = applied.metadata?.id;
    if (!workflowId) throw new Error("applied workflow has no ID");
    log(`applied workflow: id=${workflowId}`);

    // Create execution
    log("creating workflow execution...");
    const execution = await stigmer.workflowExecution.create({
      name: `sdk-smoke-exec-ts-${Date.now()}`,
      org: "test-org",
      workflowId,
      triggerMessage: "SDK acceptance smoke test",
    });

    const executionId = execution.metadata?.id;
    if (!executionId) throw new Error("created execution has no ID");
    log(`created execution: id=${executionId}`);

    // Poll until COMPLETED (30s timeout, 2s interval)
    const deadline = Date.now() + 90_000;
    let lastPhase = "";
    while (Date.now() < deadline) {
      await sleep(2000);
      const fetched = await stigmer.workflowExecution.get(executionId);
      const phase = fetched.status?.phase;

      if (phase !== undefined) {
        lastPhase = ExecutionPhase[phase] ?? String(phase);
      }

      if (phase === ExecutionPhase.EXECUTION_COMPLETED) {
        log(`execution completed: id=${executionId}`);

        // Verify task status
        const tasks = fetched.status?.tasks ?? [];
        const setGreeting = tasks.find((t) => t.taskName === "setGreeting");
        if (setGreeting) {
          assertEqual(
            "task status",
            setGreeting.status,
            WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
          );
        }

        break;
      }

      if (
        phase === ExecutionPhase.EXECUTION_FAILED ||
        phase === ExecutionPhase.EXECUTION_CANCELLED
      ) {
        throw new Error(`execution reached terminal failure phase: ${lastPhase}`);
      }
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `timed out waiting for execution to complete; last phase: ${lastPhase}`,
      );
    }

    // Cleanup
    await stigmer.workflow.delete(workflowId);

    log("Tier 2 passed");
    result.tier2 = "pass";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Tier 2 FAILED: ${msg}`);
    result.tier2 = "fail";
    result.errors.push(`tier2: ${msg}`);
    finish(1);
  }

  finish(0);
}

function assertEqual<T>(label: string, actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  result.errors.push(`unhandled: ${err instanceof Error ? err.message : String(err)}`);
  finish(1);
});
