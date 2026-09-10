// Conformance suite for the workflow `llm_call` task: a workflow whose task
// asks the model a question completes, honors a response schema, reports
// its I/O and token counts on task status, and resolves its registry model id
// before the call leaves.
// Domain: agentic / workflowexecution — the LLM-backed task as a client reads
// it on status.tasks.
//
// The task runs in the shared runner's workflow engine (call:function llm);
// each task makes exactly one provider call, scripted on the mock LLM. What is
// pinned is the status contract a console or SDK renders (DD-001 of entry
// 20260910.02; the Go offline suite's llm_call_offline_test.go and
// workflow_task_io_test.go, plus the llm_call half of
// model_resolution_offline_test.go):
// - a plain llm_call and a schema-bound llm_call both COMPLETE;
// - per-task status carries task_type (TRANSFORM for set_vars, API_CALL for
//   llm_call), an output, and for the LLM task the input/output token counts
//   the provider reported; the execution's totals sum them;
// - the registry id the task names (LLM_TASK_MODEL) reaches the provider as
//   the registry's apiModelId — asserted against the document the runner read
//   (target.modelRegistryDocument(), DD-002), never a pinned string.
import { ExecutionPhase, WorkflowTaskStatus, WorkflowTaskType } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText } from "../harness/mock-llm";
import { requireRegistryRow } from "../harness/model-registry";
import { requireLlmProxy } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { awaitTerminal, makeWorkflowExecution, taskByName } from "../support/workflowexecutions";
import {
  LLM_CALL_SET_VARS_TASK_NAME,
  LLM_CALL_TASK_NAME,
  LLM_TASK_MODEL,
  makeLlmCallWorkflow,
  type LlmCallWorkflowOptions,
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

// Provision an llm_call workflow and run one execution of it to a terminal phase.
async function runLlmCallWorkflow(
  opts: Omit<LlmCallWorkflowOptions, "org" | "name">,
): Promise<WorkflowExecution> {
  const { org } = await target.provisionTenancy();
  const workflow = await clients.workflowCommand.create(makeLlmCallWorkflow({ org, name: uniqueName("wf-llm"), ...opts }));
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));

  const execution = await clients.workflowExecutionCommand.create(
    makeWorkflowExecution({ org, name: uniqueName("wfx-llm"), workflowId: workflow.metadata!.id }),
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

describe("WorkflowExecution llm_call — completion", () => {
  it("a plain llm_call completes", async () => {
    mock.enqueue(anthropicText("HELLO"));

    const final = await runLlmCallWorkflow({ prompt: "Say hello." });

    expectCompleted(final);
    expect(taskByName(final, LLM_CALL_TASK_NAME)?.status).toBe(WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED);
    expect(mock.consumed(), "one task, one provider call").toBe(1);
  });

  it("an llm_call with a response_schema completes on a JSON text reply", async () => {
    mock.enqueue(anthropicText(`{"sentiment": "positive"}`));

    const final = await runLlmCallWorkflow({
      systemPrompt: "You are a sentiment classifier. Respond ONLY with valid JSON matching the schema.",
      prompt: "Classify the sentiment of: 'I absolutely love this product!'",
      responseSchema: {
        type: "object",
        required: ["sentiment"],
        properties: { sentiment: { type: "string", enum: ["positive", "negative", "neutral"] } },
      },
    });

    expectCompleted(final);
    expect(taskByName(final, LLM_CALL_TASK_NAME)?.status).toBe(WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED);
  });
});

describe("WorkflowExecution llm_call — task I/O and token accounting", () => {
  it("task status carries task_type, output and token counts; the execution totals sum them", async () => {
    mock.enqueue(anthropicText("Hello there.", { inputTokens: 150, outputTokens: 20 }));

    const final = await runLlmCallWorkflow({
      prompt: "Say hello",
      precedingVariables: { greeting: "hello", count: "42" },
    });

    expectCompleted(final);
    expect(final.status?.completedAt, "a completed run stamps completed_at").not.toBe("");

    const setVars = taskByName(final, LLM_CALL_SET_VARS_TASK_NAME);
    expect(setVars, "the set_vars task is on status.tasks").toBeDefined();
    expect(setVars!.taskType, "set_vars maps to TRANSFORM").toBe(WorkflowTaskType.WORKFLOW_TASK_TRANSFORM);
    expect(setVars!.output, "a set_vars task records its output").toBeDefined();

    const llm = taskByName(final, LLM_CALL_TASK_NAME);
    expect(llm, "the llm_call task is on status.tasks").toBeDefined();
    expect(llm!.taskType, "llm_call maps to API_CALL").toBe(WorkflowTaskType.WORKFLOW_TASK_API_CALL);
    expect(llm!.output, "the llm_call task records its output").toBeDefined();
    expect(llm!.inputTokens, "the provider's input token count lands on the task").toBe(150n);
    expect(llm!.outputTokens, "the provider's output token count lands on the task").toBe(20n);

    expect(final.status?.totalInputTokens, "the execution totals the tasks' input tokens").toBe(150n);
    expect(final.status?.totalOutputTokens, "the execution totals the tasks' output tokens").toBe(20n);
  });
});

describe("WorkflowExecution llm_call — model resolution", () => {
  it("an llm_call's registry model id reaches the provider as the registry's apiModelId", async () => {
    if (target.modelRegistryDocument === undefined) {
      throw new Error(`target ${target.name} exposes no model registry document; execution targets must`);
    }
    const row = requireRegistryRow(await target.modelRegistryDocument(), LLM_TASK_MODEL);
    expect(row.apiModelId, `the registry must map ${LLM_TASK_MODEL} to a provider id`).toBeDefined();
    expect(row.apiModelId, "the arm is only meaningful when resolution changes the id").not.toBe(row.id);

    mock.enqueue(anthropicText("Resolved."));
    const final = await runLlmCallWorkflow({ prompt: "Say hello." });

    expectCompleted(final);
    // A workflow task has no background titling call, so the one request on the
    // wire is the task's own.
    expect(mock.requestModels(), "the provider received the resolved api id").toEqual([row.apiModelId]);
  });
});
