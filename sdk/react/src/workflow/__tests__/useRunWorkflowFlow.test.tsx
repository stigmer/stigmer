import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerError } from "@stigmer/sdk";
import { Code } from "@connectrpc/connect";
import { StigmerContext } from "../../context";
import { useRunWorkflowFlow } from "../useRunWorkflowFlow";
import type { UseRunWorkflowFlowOptions } from "../useRunWorkflowFlow";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    metadata: {
      id: "wf-123",
      name: "my-workflow",
      slug: "my-workflow",
      ...((overrides.metadata as Record<string, unknown>) ?? {}),
    },
    spec: {
      env: {},
      ...((overrides.spec as Record<string, unknown>) ?? {}),
    },
  } as any;
}

function makeExecution(id = "wex-001") {
  return { metadata: { id } } as any;
}

const mockCreate = vi.fn();
const mockGetByReference = vi.fn();

function makeMockClient(): Stigmer {
  return {
    workflowExecution: { create: mockCreate },
    environment: { getByReference: mockGetByReference },
  } as unknown as Stigmer;
}

function defaultOptions(
  overrides: Partial<UseRunWorkflowFlowOptions> = {},
): UseRunWorkflowFlowOptions {
  return {
    org: "test-org",
    workflow: makeWorkflow(),
    instances: [],
    onSuccess: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

function renderWithClient(
  options: UseRunWorkflowFlowOptions,
  client?: Stigmer,
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client ?? makeMockClient()}>
      {children}
    </StigmerContext.Provider>
  );
  return renderHook(() => useRunWorkflowFlow(options), { wrapper });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useRunWorkflowFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue(makeExecution());
  });

  // =========================================================================
  // Unique name generation (regression test for the static-name bug)
  // =========================================================================

  describe("execution name uniqueness", () => {
    it("generates a different name on each submit", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        vi.setSystemTime(new Date("2026-05-22T12:00:00Z"));

        const opts = defaultOptions();
        const { result } = renderWithClient(opts);

        await act(async () => {
          await result.current.submit();
        });
        const firstCall = mockCreate.mock.calls[0][0];

        vi.setSystemTime(new Date("2026-05-22T12:00:05Z"));
        mockCreate.mockResolvedValue(makeExecution("wex-002"));

        await act(async () => {
          await result.current.submit();
        });
        const secondCall = mockCreate.mock.calls[1][0];

        expect(firstCall.name).not.toBe(secondCall.name);
        expect(firstCall.name).toBe("my-workflow 2026-05-22 12:00:00");
        expect(secondCall.name).toBe("my-workflow 2026-05-22 12:00:05");
      } finally {
        vi.useRealTimers();
      }
    });

    it("includes the workflow name in the execution name", async () => {
      const opts = defaultOptions({
        workflow: makeWorkflow({ metadata: { name: "daily-plan" } }),
      });
      const { result } = renderWithClient(opts);

      await act(async () => {
        await result.current.submit();
      });

      const name: string = mockCreate.mock.calls[0][0].name;
      expect(name).toMatch(/^daily-plan /);
    });

    it("falls back to slug when name is missing", async () => {
      const opts = defaultOptions({
        workflow: makeWorkflow({
          metadata: { id: "wf-1", name: "", slug: "fallback-slug" },
        }),
      });
      const { result } = renderWithClient(opts);

      await act(async () => {
        await result.current.submit();
      });

      const name: string = mockCreate.mock.calls[0][0].name;
      expect(name).toMatch(/^fallback-slug /);
    });
  });

  // =========================================================================
  // Required env validation
  // =========================================================================

  describe("env validation", () => {
    it("blocks submit when a required env var is missing", async () => {
      const opts = defaultOptions({
        workflow: makeWorkflow({
          spec: {
            env: {
              DB_URL: { optional: false, isSecret: false },
            },
          },
        }),
      });
      const { result } = renderWithClient(opts);

      await act(async () => {
        await result.current.submit();
      });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(result.current.fieldErrors).toHaveProperty("DB_URL");
    });

    it("allows submit when optional env var is empty", async () => {
      const opts = defaultOptions({
        workflow: makeWorkflow({
          spec: {
            env: {
              SLACK_TOKEN: { optional: true, isSecret: false },
            },
          },
        }),
      });
      const { result } = renderWithClient(opts);

      await act(async () => {
        await result.current.submit();
      });

      expect(mockCreate).toHaveBeenCalled();
      expect(result.current.fieldErrors).toEqual({});
    });

    it("marks secret env vars with isSecret in runtimeEnv", async () => {
      const opts = defaultOptions({
        workflow: makeWorkflow({
          spec: {
            env: {
              API_KEY: { optional: false, isSecret: true },
            },
          },
        }),
      });
      const { result } = renderWithClient(opts);

      act(() => {
        result.current.setEnvVar("API_KEY", "secret-value");
      });

      await act(async () => {
        await result.current.submit();
      });

      const runtimeEnv = mockCreate.mock.calls[0][0].runtimeEnv;
      expect(runtimeEnv).toEqual({
        API_KEY: { value: "secret-value", isSecret: true },
      });
    });
  });

  // =========================================================================
  // Submit success
  // =========================================================================

  describe("submit success", () => {
    it("calls onSuccess with the execution ID", async () => {
      const onSuccess = vi.fn();
      const opts = defaultOptions({ onSuccess });
      const { result } = renderWithClient(opts);

      await act(async () => {
        await result.current.submit();
      });

      expect(onSuccess).toHaveBeenCalledWith("wex-001");
      expect(result.current.error).toBeNull();
      expect(result.current.isSubmitting).toBe(false);
    });

    it("passes org and workflowId when no instance is selected", async () => {
      const opts = defaultOptions();
      const { result } = renderWithClient(opts);

      await act(async () => {
        await result.current.submit();
      });

      const input = mockCreate.mock.calls[0][0];
      expect(input.org).toBe("test-org");
      expect(input.workflowId).toBe("wf-123");
      expect(input.workflowInstanceId).toBeUndefined();
    });
  });

  // =========================================================================
  // Submit failure
  // =========================================================================

  describe("submit failure", () => {
    it("sets error on duplicate slug rejection", async () => {
      const errorMsg =
        "WorkflowExecution with slug 'my-workflow' already exists in org 'test-org'";
      mockCreate.mockRejectedValue(
        new StigmerError("already-exists", errorMsg, Code.AlreadyExists),
      );

      const onError = vi.fn();
      const opts = defaultOptions({ onError });
      const { result } = renderWithClient(opts);

      await act(async () => {
        await result.current.submit();
      });

      expect(result.current.error).toBe(errorMsg);
      expect(onError).toHaveBeenCalledWith(errorMsg);
      expect(result.current.isSubmitting).toBe(false);
    });

    it("uses fallback message for unknown errors", async () => {
      mockCreate.mockRejectedValue(new Error(""));

      const opts = defaultOptions();
      const { result } = renderWithClient(opts);

      await act(async () => {
        await result.current.submit();
      });

      expect(result.current.error).toBeTruthy();
    });
  });

  // =========================================================================
  // Reset
  // =========================================================================

  describe("reset", () => {
    it("clears all form state after a failed submit", async () => {
      mockCreate.mockRejectedValue(new Error("fail"));

      const opts = defaultOptions({
        workflow: makeWorkflow({
          spec: { env: { KEY: { optional: false, isSecret: false } } },
        }),
      });
      const { result } = renderWithClient(opts);

      act(() => {
        result.current.setTriggerMessage("hello");
        result.current.setEnvVar("KEY", "val");
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(result.current.error).toBeTruthy();

      act(() => {
        result.current.reset();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.triggerMessage).toBe("");
      expect(result.current.runtimeEnv).toEqual({});
      expect(result.current.fieldErrors).toEqual({});
      expect(result.current.selectedInstanceId).toBeNull();
    });
  });

  // =========================================================================
  // Instance selection routing
  // =========================================================================

  describe("instance selection", () => {
    it("sends workflowInstanceId instead of workflowId when instance is selected", async () => {
      const opts = defaultOptions();
      const { result } = renderWithClient(opts);

      act(() => {
        result.current.setSelectedInstanceId("wfi-456");
      });

      await act(async () => {
        await result.current.submit();
      });

      const input = mockCreate.mock.calls[0][0];
      expect(input.workflowInstanceId).toBe("wfi-456");
      expect(input.workflowId).toBeUndefined();
    });

    it("skips validation for required env vars satisfied by instance environments", async () => {
      mockGetByReference.mockResolvedValue({
        spec: { data: { DB_URL: { value: "postgres://...", isSecret: true } } },
      });

      const instance = {
        metadata: { id: "wfi-789", name: "prod", slug: "prod", org: "test-org" },
        spec: {
          workflowId: "wf-123",
          environmentRefs: [{ org: "test-org", slug: "prod-env" }],
        },
      } as any;

      const opts = defaultOptions({
        workflow: makeWorkflow({
          spec: {
            env: {
              DB_URL: { optional: false, isSecret: true },
            },
          },
        }),
        instances: [instance],
      });

      const { result } = renderWithClient(opts);

      act(() => {
        result.current.setSelectedInstanceId("wfi-789");
      });

      await waitFor(() => {
        expect(result.current.instanceEnvKeys.has("DB_URL")).toBe(true);
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(mockCreate).toHaveBeenCalled();
      expect(result.current.fieldErrors).toEqual({});
    });
  });

  // =========================================================================
  // Trigger input detection and visibility
  // =========================================================================

  describe("trigger input visibility", () => {
    it("sets usesTriggerInput=false when no task references $input", () => {
      const opts = defaultOptions({
        workflow: makeWorkflow({
          spec: {
            env: { KEY: { optional: false, isSecret: false } },
            tasks: [
              {
                name: "run",
                kind: 1,
                taskConfig: { agent: "analyst", message: "${ $env.KEY }" },
              },
            ],
          },
        }),
      });
      const { result } = renderWithClient(opts);

      expect(result.current.usesTriggerInput).toBe(false);
      expect(result.current.showTriggerMessage).toBe(false);
    });

    it("sets usesTriggerInput=true when a task references $input", () => {
      const opts = defaultOptions({
        workflow: makeWorkflow({
          spec: {
            tasks: [
              {
                name: "route",
                kind: 1,
                taskConfig: { when: "${ $input.score > 80 }" },
              },
            ],
          },
        }),
      });
      const { result } = renderWithClient(opts);

      expect(result.current.usesTriggerInput).toBe(true);
      expect(result.current.showTriggerMessage).toBe(true);
    });

    it("allows toggling showTriggerMessage via escape hatch", () => {
      const opts = defaultOptions();
      const { result } = renderWithClient(opts);

      expect(result.current.showTriggerMessage).toBe(false);

      act(() => {
        result.current.setShowTriggerMessage(true);
      });

      expect(result.current.showTriggerMessage).toBe(true);
    });

    it("resets showTriggerMessage to usesTriggerInput on reset()", () => {
      const opts = defaultOptions();
      const { result } = renderWithClient(opts);

      act(() => {
        result.current.setShowTriggerMessage(true);
      });
      expect(result.current.showTriggerMessage).toBe(true);

      act(() => {
        result.current.reset();
      });
      expect(result.current.showTriggerMessage).toBe(false);
    });

    it("still sends triggerMessage when field was toggled open and filled", async () => {
      const opts = defaultOptions();
      const { result } = renderWithClient(opts);

      act(() => {
        result.current.setShowTriggerMessage(true);
        result.current.setTriggerMessage('{"intent": "test"}');
      });

      await act(async () => {
        await result.current.submit();
      });

      const input = mockCreate.mock.calls[0][0];
      expect(input.triggerMessage).toBe('{"intent": "test"}');
    });
  });
});
