/**
 * Pins the hydration activity: what it reads from the server for a run and
 * what it refuses. A run executes the workflow version it pinned at create;
 * the live workflow is read only for a run that pins none, and a pinned
 * version that cannot be read is never answered with the head.
 */
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

const PINNED_YAML = `
document:
  dsl: "1.0.0"
  name: pinned-workflow
  namespace: default
do:
  - greet:
      set:
        message: pinned
`;

const PINNED_HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/** A run row that pinned {@link PINNED_HASH} at create. */
const PINNED_EXECUTION = {
  spec: { triggerMessage: "" },
  status: { workflowVersionHash: PINNED_HASH },
};

function makeInput(overrides: Partial<HydrateInput> = {}): HydrateInput {
  return {
    execution_id: "wfx_test-123",
    workflow_id: "wfl_wf-789",
    org_id: "org_test",
    ...overrides,
  };
}

function makeMockClient(opts: {
  workflowExecution?: unknown;
  workflow?: unknown;
  workflowVersion?: unknown;
  executionContext?: unknown;
  workflowExecutionError?: unknown;
  workflowError?: unknown;
  workflowVersionError?: unknown;
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
    getWorkflowVersion: opts.workflowVersionError
      ? vi.fn().mockRejectedValue(opts.workflowVersionError)
      : vi.fn().mockResolvedValue(opts.workflowVersion ?? {
          validatedYaml: PINNED_YAML,
        }),
    // No scoped token — the OSS/local shape (no runner credential to exchange).
    acquireScopedRunnerToken: vi.fn().mockResolvedValue(undefined),
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

  it("fails non-retryably, naming the execution, when the run names no workflow", async () => {
    const client = makeMockClient();
    const input = makeInput({ workflow_id: "" });

    const err = await hydrateWorkflowExecution(input, client).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
    expect((err as ApplicationFailure).type).toBe("MISSING_WORKFLOW_REFERENCE");
    expect((err as ApplicationFailure).message).toContain("wfx_test-123");
    expect(client.getWorkflow).not.toHaveBeenCalled();
  });

  describe("the workflow version a run executes", () => {
    it("reads the live workflow for a run that pins no version", async () => {
      const client = makeMockClient({
        workflowExecution: { spec: { triggerMessage: "" }, status: { workflowVersionHash: "" } },
      });

      const result = await hydrateWorkflowExecution(makeInput(), client);

      expect(client.getWorkflow).toHaveBeenCalledWith("wfl_wf-789");
      expect(client.getWorkflowVersion).not.toHaveBeenCalled();
      expect(result.model.document.name).toBe("test-workflow");
    });

    it("runs the pinned version's YAML, never the live workflow", async () => {
      const client = makeMockClient({ workflowExecution: PINNED_EXECUTION });

      const result = await hydrateWorkflowExecution(makeInput(), client);

      expect(client.getWorkflowVersion).toHaveBeenCalledWith("wfl_wf-789", PINNED_HASH);
      expect(client.getWorkflow).not.toHaveBeenCalled();
      expect(result.model.document.name).toBe("pinned-workflow");
    });

    it("fails non-retryably, naming the version and workflow, when the pinned version is NOT_FOUND", async () => {
      const client = makeMockClient({
        workflowExecution: PINNED_EXECUTION,
        workflowVersionError: Object.assign(new Error("version not found"), { code: 5 }),
      });

      const err = await hydrateWorkflowExecution(makeInput(), client).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).nonRetryable).toBe(true);
      expect((err as ApplicationFailure).type).toBe("WORKFLOW_VERSION_NOT_FOUND");
      expect((err as ApplicationFailure).message).toContain(PINNED_HASH.slice(0, 12));
      expect((err as ApplicationFailure).message).toContain("wfl_wf-789");
      expect(client.getWorkflow).not.toHaveBeenCalled();
    });

    it("rethrows a transient error from the version read for the activity's retry policy", async () => {
      const transient = Object.assign(new Error("connection reset"), { code: 14 });
      const client = makeMockClient({
        workflowExecution: PINNED_EXECUTION,
        workflowVersionError: transient,
      });

      const err = await hydrateWorkflowExecution(makeInput(), client).catch((e: unknown) => e);

      expect(err).toBe(transient);
      expect(client.getWorkflow).not.toHaveBeenCalled();
    });

    it("fails non-retryably, naming the version, on a refusal or a malformed request a retry cannot change", async () => {
      for (const code of [3, 7, 9]) {
        const client = makeMockClient({
          workflowExecution: PINNED_EXECUTION,
          workflowVersionError: Object.assign(new Error("refused"), { code }),
        });

        const err = await hydrateWorkflowExecution(makeInput(), client).catch((e: unknown) => e);

        expect(err, `code ${code}`).toBeInstanceOf(ApplicationFailure);
        expect((err as ApplicationFailure).nonRetryable).toBe(true);
        expect((err as ApplicationFailure).type).toBe("WORKFLOW_VERSION_UNREADABLE");
        expect((err as ApplicationFailure).message).toContain(PINNED_HASH.slice(0, 12));
        expect(client.getWorkflow).not.toHaveBeenCalled();
      }
    });

    it("fails non-retryably when the pinned version carries no YAML", async () => {
      const client = makeMockClient({
        workflowExecution: PINNED_EXECUTION,
        workflowVersion: { validatedYaml: "" },
      });

      const err = await hydrateWorkflowExecution(makeInput(), client).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).nonRetryable).toBe(true);
      expect((err as ApplicationFailure).type).toBe("WORKFLOW_VERSION_YAML_EMPTY");
      expect(client.getWorkflow).not.toHaveBeenCalled();
    });
  });

  it("assembles metadata correctly from input fields", async () => {
    const client = makeMockClient();
    const input = makeInput({
      execution_id: "exec-abc",
      workflow_id: "wfl_xyz",
      org_id: "org_test",
    });

    const result = await hydrateWorkflowExecution(input, client);

    expect(result.metadata).toEqual({
      execution_id: "exec-abc",
      workflow_id: "wfl_xyz",
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
