import { describe, it, expect, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/activity";
import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import { hydrateWorkflowExecution, type HydrateInput } from "../hydrate-workflow-execution.js";
import type { StigmerClient } from "../../client/stigmer-client.js";

const VALID_YAML = `
document:
  dsl: "1.0.0"
  name: test-workflow
  namespace: default
do:
  - greet:
      set:
        message: hello
`;

function makeInput(overrides: Partial<HydrateInput> = {}): HydrateInput {
  return {
    execution_id: "wfx_test-123",
    workflow_instance_id: "wfi_inst-456",
    workflow_id: "wfl_wf-789",
    org_id: "org_test",
    ...overrides,
  };
}

function makeMockClient(opts: {
  workflowExecution?: unknown;
  workflow?: unknown;
  workflowInstance?: unknown;
  executionContext?: unknown;
  workflowExecutionError?: unknown;
  workflowError?: unknown;
  workflowInstanceError?: unknown;
  executionContextError?: unknown;
} = {}) {
  return {
    getWorkflowExecution: opts.workflowExecutionError
      ? vi.fn().mockRejectedValue(opts.workflowExecutionError)
      : vi.fn().mockResolvedValue(opts.workflowExecution ?? {
          spec: { triggerMessage: '{"key": "value"}' },
        }),
    getWorkflow: opts.workflowError
      ? vi.fn().mockRejectedValue(opts.workflowError)
      : vi.fn().mockResolvedValue(opts.workflow ?? {
          status: {
            serverlessWorkflowValidation: {
              state: ValidationState.VALID,
              yaml: VALID_YAML,
              errors: [],
            },
          },
        }),
    getWorkflowInstance: opts.workflowInstanceError
      ? vi.fn().mockRejectedValue(opts.workflowInstanceError)
      : vi.fn().mockResolvedValue(opts.workflowInstance ?? {
          spec: { workflowId: "wfl_resolved-from-instance" },
        }),
    getExecutionContextByExecutionId: opts.executionContextError
      ? vi.fn().mockRejectedValue(opts.executionContextError)
      : vi.fn().mockResolvedValue(opts.executionContext ?? {
          spec: {
            data: {
              API_KEY: { value: "sk-live-abc", isSecret: true },
              API_URL: { value: "https://api.example.com", isSecret: false },
            },
          },
        }),
  } as unknown as StigmerClient;
}

describe("hydrateWorkflowExecution", () => {
  it("returns materialized input on happy path", async () => {
    const client = makeMockClient();
    const result = await hydrateWorkflowExecution(makeInput(), client);

    expect(result.model.document.name).toBe("test-workflow");
    expect(result.model.document.dsl).toBe("1.0.0");
    expect(result.model.do).toHaveLength(1);
    expect(result.workflow_input).toEqual({ key: "value" });
    expect(result.env).toEqual({
      API_KEY: "sk-live-abc",
      API_URL: "https://api.example.com",
    });
    expect(result.metadata).toEqual({
      execution_id: "wfx_test-123",
      workflow_id: "wfl_wf-789",
      workflow_instance_id: "wfi_inst-456",
      org_id: "org_test",
    });
  });

  it("flattens ExecutionContext data correctly — secrets and config in same map", async () => {
    const client = makeMockClient({
      executionContext: {
        spec: {
          data: {
            SECRET_KEY: { value: "s3cret", isSecret: true },
            PUBLIC_HOST: { value: "example.com", isSecret: false },
            ANOTHER_SECRET: { value: "token123", isSecret: true },
          },
        },
      },
    });

    const result = await hydrateWorkflowExecution(makeInput(), client);

    expect(result.env).toEqual({
      SECRET_KEY: "s3cret",
      PUBLIC_HOST: "example.com",
      ANOTHER_SECRET: "token123",
    });
  });

  describe("trigger_message parsing", () => {
    it("parses valid JSON trigger_message as workflow_input", async () => {
      const client = makeMockClient({
        workflowExecution: {
          spec: { triggerMessage: '{"items": [1, 2, 3]}' },
        },
      });
      const result = await hydrateWorkflowExecution(makeInput(), client);
      expect(result.workflow_input).toEqual({ items: [1, 2, 3] });
    });

    it("returns null for invalid JSON trigger_message", async () => {
      const client = makeMockClient({
        workflowExecution: {
          spec: { triggerMessage: "not valid json" },
        },
      });
      const result = await hydrateWorkflowExecution(makeInput(), client);
      expect(result.workflow_input).toBeNull();
    });

    it("returns null for empty trigger_message", async () => {
      const client = makeMockClient({
        workflowExecution: { spec: { triggerMessage: "" } },
      });
      const result = await hydrateWorkflowExecution(makeInput(), client);
      expect(result.workflow_input).toBeNull();
    });

    it("returns null for missing trigger_message", async () => {
      const client = makeMockClient({
        workflowExecution: { spec: {} },
      });
      const result = await hydrateWorkflowExecution(makeInput(), client);
      expect(result.workflow_input).toBeNull();
    });
  });

  describe("validation state handling", () => {
    it("throws non-retryable error for INVALID validation state", async () => {
      const client = makeMockClient({
        workflow: {
          status: {
            serverlessWorkflowValidation: {
              state: ValidationState.INVALID,
              yaml: "",
              errors: ["Task 'bad-task' has invalid call type"],
            },
          },
        },
      });

      await expect(hydrateWorkflowExecution(makeInput(), client))
        .rejects.toThrow("validation failed");
    });

    it("throws retryable error for PENDING validation state", async () => {
      const client = makeMockClient({
        workflow: {
          status: {
            serverlessWorkflowValidation: {
              state: ValidationState.PENDING,
              yaml: "",
              errors: [],
            },
          },
        },
      });

      try {
        await hydrateWorkflowExecution(makeInput(), client);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApplicationFailure);
        expect((err as ApplicationFailure).message).toContain("still in progress");
      }
    });

    it("throws non-retryable error for FAILED validation state", async () => {
      const client = makeMockClient({
        workflow: {
          status: {
            serverlessWorkflowValidation: {
              state: ValidationState.FAILED,
              yaml: "",
              errors: [],
            },
          },
        },
      });

      await expect(hydrateWorkflowExecution(makeInput(), client))
        .rejects.toThrow("system error");
    });
  });

  it("throws non-retryable error for empty YAML despite VALID state", async () => {
    const client = makeMockClient({
      workflow: {
        status: {
          serverlessWorkflowValidation: {
            state: ValidationState.VALID,
            yaml: "",
            errors: [],
          },
        },
      },
    });

    await expect(hydrateWorkflowExecution(makeInput(), client))
      .rejects.toThrow("empty YAML");
  });

  describe("gRPC NOT_FOUND errors", () => {
    it("throws non-retryable error when WorkflowExecution not found", async () => {
      const client = makeMockClient({
        workflowExecutionError: { code: "not_found" },
      });

      await expect(hydrateWorkflowExecution(makeInput(), client))
        .rejects.toThrow("WorkflowExecution 'wfx_test-123' not found");
    });

    it("throws non-retryable error when Workflow not found", async () => {
      const client = makeMockClient({
        workflowError: { code: "not_found" },
      });

      await expect(hydrateWorkflowExecution(makeInput(), client))
        .rejects.toThrow("Workflow 'wfl_wf-789' not found");
    });

    it("uses empty env when ExecutionContext not found (ConnectError numeric code)", async () => {
      const client = makeMockClient({
        executionContextError: Object.assign(new Error("not found"), { code: 5 }),
      });

      const result = await hydrateWorkflowExecution(makeInput(), client);
      expect(result.env).toEqual({});
    });
  });

  it("throws non-retryable error for malformed YAML", async () => {
    const client = makeMockClient({
      workflow: {
        status: {
          serverlessWorkflowValidation: {
            state: ValidationState.VALID,
            yaml: "not: a: valid: workflow: yaml",
            errors: [],
          },
        },
      },
    });

    await expect(hydrateWorkflowExecution(makeInput(), client))
      .rejects.toThrow("Failed to parse");
  });

  it("resolves workflow ID from WorkflowInstance when workflow_id is empty", async () => {
    const client = makeMockClient();
    const input = makeInput({ workflow_id: "" });

    const result = await hydrateWorkflowExecution(input, client);

    expect(client.getWorkflowInstance).toHaveBeenCalledWith("wfi_inst-456");
    expect(client.getWorkflow).toHaveBeenCalledWith("wfl_resolved-from-instance");
    expect(result.metadata?.workflow_id).toBe("wfl_resolved-from-instance");
  });

  it("throws when neither workflow_id nor workflow_instance_id provided", async () => {
    const client = makeMockClient();
    const input = makeInput({ workflow_id: "", workflow_instance_id: "" });

    await expect(hydrateWorkflowExecution(input, client))
      .rejects.toThrow("Neither workflow_id nor workflow_instance_id");
  });

  it("assembles metadata correctly from input fields", async () => {
    const client = makeMockClient();
    const input = makeInput({
      execution_id: "exec-abc",
      workflow_id: "wfl_xyz",
      workflow_instance_id: "wfi_123",
      org_id: "org_test",
    });

    const result = await hydrateWorkflowExecution(input, client);

    expect(result.metadata).toEqual({
      execution_id: "exec-abc",
      workflow_id: "wfl_xyz",
      workflow_instance_id: "wfi_123",
      org_id: "org_test",
    });
  });

  it("throws non-retryable error when workflow has no validation in status", async () => {
    const client = makeMockClient({
      workflow: { status: {} },
    });

    await expect(hydrateWorkflowExecution(makeInput(), client))
      .rejects.toThrow("no serverless_workflow_validation");
  });
});
