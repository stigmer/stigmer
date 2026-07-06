import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StigmerContext } from "../../context";
import { useCreateAgentExecution } from "../useCreateAgentExecution";

const mockCreate = vi.fn();

function makeMockClient(): Stigmer {
  return {
    agentExecution: { create: mockCreate },
  } as unknown as Stigmer;
}

function createWrapper(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({ metadata: { id: "aex-1" } });
});

describe("useCreateAgentExecution — executionConfig mapping", () => {
  it("maps buildFromPlan into executionConfig (the Build-from-plan turn)", async () => {
    const { result } = renderHook(() => useCreateAgentExecution(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        sessionId: "ses-1",
        message: "Build from plan",
        interactionMode: "agent",
        buildFromPlan: true,
      });
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].executionConfig).toMatchObject({
      interactionMode: InteractionMode.AGENT,
      buildFromPlan: true,
    });
  });

  it("builds an executionConfig when buildFromPlan is the only config input", async () => {
    const { result } = renderHook(() => useCreateAgentExecution(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        sessionId: "ses-1",
        message: "Build from plan",
        buildFromPlan: true,
      });
    });

    expect(mockCreate.mock.calls[0][0].executionConfig).toMatchObject({
      buildFromPlan: true,
    });
  });

  it("omits executionConfig entirely for an ordinary message", async () => {
    const { result } = renderHook(() => useCreateAgentExecution(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        sessionId: "ses-1",
        message: "Hello",
      });
    });

    expect(mockCreate.mock.calls[0][0].executionConfig).toBeUndefined();
  });
});

describe("useCreateAgentExecution — supersede link (edit-and-resubmit)", () => {
  it("maps supersedesExecutionId into the create call", async () => {
    const { result } = renderHook(() => useCreateAgentExecution(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        sessionId: "ses-1",
        message: "corrected message",
        supersedesExecutionId: "aex-old",
      });
    });

    expect(mockCreate.mock.calls[0][0].supersedesExecutionId).toBe("aex-old");
  });

  it("leaves supersedesExecutionId undefined for ordinary sends", async () => {
    const { result } = renderHook(() => useCreateAgentExecution(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        sessionId: "ses-1",
        message: "Hello",
      });
    });

    expect(mockCreate.mock.calls[0][0].supersedesExecutionId).toBeUndefined();
  });
});
