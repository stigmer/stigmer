// Conformance suite for the workflow `eval` task: an LLM judge scores a
// subject against a rubric, and the task's scoring mode and failure policy
// decide what a low score does to the run.
// Domain: agentic / workflowexecution — the judge task as a client reads it on
// status.tasks.
//
// The judge is the mock LLM. The runner binds a forced structured-output tool
// for the verdict (LangChain's withStructuredOutput, tool name `extract`), so
// the script is one tool_use turn named `extract` carrying the verdict fields:
// `{pass, reasoning}` for EVAL_PASS_FAIL, `{score, reasoning}` for
// EVAL_NUMERIC_SCORE. Pinned (DD-001 of entry 20260910.02; the Go offline
// suite's eval_offline_test.go):
// - a passing pass/fail verdict completes the run;
// - a numeric score above the threshold completes the run;
// - a numeric score BELOW the threshold under EVAL_FAIL_WARN does not fail the
//   run: the eval task completes, the next task runs, the run completes. (The
//   RAISE policy on a failing score is the raise_error contract the recover
//   suite already carries; it is not duplicated here.)
import { ExecutionPhase, WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicToolUse } from "../harness/mock-llm";
import { requireLlmProxy } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { awaitTerminal, makeWorkflowExecution, taskByName } from "../support/workflowexecutions";
import {
  EVAL_AFTER_TASK_NAME,
  EVAL_EXTRACT_TOOL_NAME,
  EVAL_SUBJECT_TASK_NAME,
  EVAL_TASK_NAME,
  makeEvalWorkflow,
  type EvalWorkflowOptions,
} from "../support/workflows";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

async function runEvalWorkflow(opts: Omit<EvalWorkflowOptions, "org" | "name">): Promise<WorkflowExecution> {
  const { org } = await target.provisionTenancy();
  const workflow = await clients.workflowCommand.create(makeEvalWorkflow({ org, name: uniqueName("wf-eval"), ...opts }));
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));

  const execution = await clients.workflowExecutionCommand.create(
    makeWorkflowExecution({ org, name: uniqueName("wfx-eval"), workflowId: workflow.metadata!.id }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));
  return awaitTerminal(clients, executionId);
}

function expectCompleted(final: WorkflowExecution): void {
  expect(
    final.status?.phase,
    `the workflow should complete; reached ${ExecutionPhase[final.status?.phase ?? 0]} ` +
      `(status.error: ${JSON.stringify(final.status?.error ?? "")})`,
  ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
}

function expectTaskCompleted(final: WorkflowExecution, taskName: string): void {
  expect(taskByName(final, taskName)?.status, `${taskName} completed`).toBe(WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED);
}

describe("WorkflowExecution eval — scoring modes", () => {
  it("a pass/fail eval completes when the judge's forced extract tool answers pass", async () => {
    mock.enqueue(
      anthropicToolUse("toolu_eval_pass", EVAL_EXTRACT_TOOL_NAME, {
        pass: true,
        reasoning: "The statement is factually accurate.",
      }),
    );

    const final = await runEvalWorkflow({
      subject: "The Earth orbits the Sun. It takes approximately 365.25 days to complete one orbit.",
      rubric: "Is this statement factually accurate?",
      scoringMode: "EVAL_PASS_FAIL",
      onFail: "EVAL_FAIL_RAISE",
    });

    expectCompleted(final);
    expectTaskCompleted(final, EVAL_SUBJECT_TASK_NAME);
    expectTaskCompleted(final, EVAL_TASK_NAME);
    expect(mock.consumed(), "one judge call").toBe(1);
  });

  it("a numeric-score eval above its threshold completes", async () => {
    mock.enqueue(
      anthropicToolUse("toolu_eval_score", EVAL_EXTRACT_TOOL_NAME, {
        score: 0.85,
        reasoning: "The definition is clear and accurate.",
      }),
    );

    const final = await runEvalWorkflow({
      subject: "Machine learning is a subset of artificial intelligence.",
      rubric: "Rate the clarity and accuracy on a scale from 0.0 to 1.0.",
      scoringMode: "EVAL_NUMERIC_SCORE",
      threshold: 0.3,
      onFail: "EVAL_FAIL_RAISE",
    });

    expectCompleted(final);
    expectTaskCompleted(final, EVAL_TASK_NAME);
  });
});

describe("WorkflowExecution eval — failure policy", () => {
  it("a failing score under the warn policy runs the next task and completes", async () => {
    mock.enqueue(
      anthropicToolUse("toolu_eval_low", EVAL_EXTRACT_TOOL_NAME, {
        score: 0.2,
        reasoning: "The text is not a well-formed sentence.",
      }),
    );

    const final = await runEvalWorkflow({
      subject: "asdfghjkl qwerty zxcvbnm",
      rubric: "Is this a well-formed English sentence?",
      scoringMode: "EVAL_NUMERIC_SCORE",
      threshold: 0.9,
      onFail: "EVAL_FAIL_WARN",
      withAfterTask: true,
    });

    expectCompleted(final);
    expectTaskCompleted(final, EVAL_TASK_NAME);
    expectTaskCompleted(final, EVAL_AFTER_TASK_NAME);
  });
});
