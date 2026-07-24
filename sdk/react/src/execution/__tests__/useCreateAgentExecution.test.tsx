import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { Harness, ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
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

describe("useCreateAgentExecution — one-call session bootstrap (sessionSpec)", () => {
  it("converts harness and executionTarget options to proto enums", async () => {
    const { result } = renderHook(() => useCreateAgentExecution(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        message: "Customize the landing page",
        sessionSpec: {
          agentInstanceId: "ain-1",
          workspaceEntries: [
            { name: "site", source: { localPath: { path: "/repos/site" } } },
          ],
          harness: "native",
          executionTarget: "local",
        },
      });
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const input = mockCreate.mock.calls[0][0];
    expect(input.sessionId).toBeUndefined();
    expect(input.sessionSpec).toMatchObject({
      agentInstanceId: "ain-1",
      harness: Harness.NATIVE,
      executionTarget: ExecutionTarget.LOCAL,
    });
    expect(input.sessionSpec.workspaceEntries).toEqual([
      { name: "site", source: { localPath: { path: "/repos/site" } } },
    ]);
  });

  it("leaves harness and executionTarget undefined when not chosen (server decides)", async () => {
    const { result } = renderHook(() => useCreateAgentExecution(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        message: "Hello",
        sessionSpec: { agentInstanceId: "ain-1" },
      });
    });

    const input = mockCreate.mock.calls[0][0];
    expect(input.sessionSpec.harness).toBeUndefined();
    expect(input.sessionSpec.executionTarget).toBeUndefined();
  });

  it("passes the metadata map through on the bootstrap spec", async () => {
    const { result } = renderHook(() => useCreateAgentExecution(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        message: "Hello",
        sessionSpec: {
          agentInstanceId: "ain-1",
          metadata: { "acme/tenant": "t-1" },
        },
      });
    });

    const input = mockCreate.mock.calls[0][0];
    expect(input.sessionSpec.metadata).toEqual({ "acme/tenant": "t-1" });
  });

  it("maps the typed sessionContext onto the reserved metadata key", async () => {
    const { result } = renderHook(() => useCreateAgentExecution(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        message: "Hello",
        sessionSpec: {
          agentInstanceId: "ain-1",
          sessionContext: "Role: platform admin",
        },
      });
    });

    const input = mockCreate.mock.calls[0][0];
    expect(input.sessionSpec.metadata).toEqual({
      "stigmer.ai/session-context": "Role: platform admin",
    });
  });

  it("lets the typed sessionContext win over a raw entry under the reserved key", async () => {
    const { result } = renderHook(() => useCreateAgentExecution(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        message: "Hello",
        sessionSpec: {
          agentInstanceId: "ain-1",
          metadata: {
            "acme/tenant": "t-1",
            "stigmer.ai/session-context": "stale raw value",
          },
          sessionContext: "typed value",
        },
      });
    });

    const input = mockCreate.mock.calls[0][0];
    expect(input.sessionSpec.metadata).toEqual({
      "acme/tenant": "t-1",
      "stigmer.ai/session-context": "typed value",
    });
  });

  it("omits metadata entirely when neither field is provided", async () => {
    const { result } = renderHook(() => useCreateAgentExecution(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        message: "Hello",
        sessionSpec: { agentInstanceId: "ain-1" },
      });
    });

    const input = mockCreate.mock.calls[0][0];
    expect(input.sessionSpec.metadata).toBeUndefined();
  });

  it("returns the server-assigned session id from the bootstrap response", async () => {
    mockCreate.mockResolvedValueOnce({
      metadata: { id: "aex-1" },
      spec: { sessionId: "ses-created" },
    });
    const { result } = renderHook(() => useCreateAgentExecution(), {
      wrapper: createWrapper(makeMockClient()),
    });

    let created: { executionId: string; sessionId: string } | undefined;
    await act(async () => {
      created = await result.current.create({
        org: "acme",
        message: "Hello",
        sessionSpec: { agentInstanceId: "ain-1" },
      });
    });

    expect(created).toEqual({ executionId: "aex-1", sessionId: "ses-created" });
  });

  it("echoes the input session id on the existing-session path", async () => {
    const { result } = renderHook(() => useCreateAgentExecution(), {
      wrapper: createWrapper(makeMockClient()),
    });

    let created: { executionId: string; sessionId: string } | undefined;
    await act(async () => {
      created = await result.current.create({
        org: "acme",
        sessionId: "ses-1",
        message: "Hello",
      });
    });

    expect(created).toEqual({ executionId: "aex-1", sessionId: "ses-1" });
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
