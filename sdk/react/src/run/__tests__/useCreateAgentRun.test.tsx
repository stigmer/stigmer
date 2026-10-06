import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import {
  InteractionMode,
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { Harness, ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { StigmerContext } from "../../context";
import { useCreateAgentRun } from "../useCreateAgentRun";

const mockCreate = vi.fn();

function makeMockClient(): Stigmer {
  return {
    agentRun: { create: mockCreate },
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

describe("useCreateAgentRun — run_config and the per-message intents", () => {
  async function createWith(fields: Partial<Parameters<ReturnType<typeof useCreateAgentRun>["create"]>[0]>) {
    const { result } = renderHook(() => useCreateAgentRun(), {
      wrapper: createWrapper(makeMockClient()),
    });
    await act(async () => {
      await result.current.create({
        org: "acme",
        sessionId: "ses-1",
        message: "Hello",
        ...fields,
      } as Parameters<typeof result.current.create>[0]);
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    return mockCreate.mock.calls[0][0];
  }

  it("sends the intents at the top level, outside run_config (the Build-from-plan turn)", async () => {
    const input = await createWith({
      message: "Build from plan",
      interactionMode: "agent",
      buildFromPlan: true,
    });
    expect(input.interactionMode).toBe(InteractionMode.AGENT);
    expect(input.buildFromPlan).toBe(true);
    expect(input.runConfig).toBeUndefined();
  });

  it("carries the structured-output schema at the top level", async () => {
    const schema = { type: "object" };
    const input = await createWith({ structuredOutputSchema: schema });
    expect(input.structuredOutputSchema).toEqual(schema);
    expect(input.runConfig).toBeUndefined();
  });

  it("puts model, tier and thinking in run_config", async () => {
    const input = await createWith({
      modelName: "claude-sonnet-4.6",
      serviceTier: "fast",
      thinkingMode: "enabled",
    });
    expect(input.runConfig).toEqual({
      modelName: "claude-sonnet-4.6",
      serviceTier: ServiceTier.FAST,
      thinkingMode: ThinkingMode.ENABLED,
    });
  });

  it("sends an explicit off alone: it adjusts the model a less specific layer chose", async () => {
    const input = await createWith({
      serviceTier: "standard",
      thinkingMode: "disabled",
    });
    expect(input.runConfig).toEqual({
      serviceTier: ServiceTier.STANDARD,
      thinkingMode: ThinkingMode.DISABLED,
    });
  });

  it("omits run_config and every intent for an ordinary message", async () => {
    const input = await createWith({});
    expect(input.runConfig).toBeUndefined();
    expect(input.interactionMode).toBeUndefined();
    expect(input.buildFromPlan).toBeUndefined();
    expect(input.structuredOutputSchema).toBeUndefined();
  });
});

describe("useCreateAgentRun — one-call session bootstrap (sessionSpec)", () => {
  it("converts harness and executionTarget options to proto enums", async () => {
    const { result } = renderHook(() => useCreateAgentRun(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        message: "Customize the landing page",
        sessionSpec: {
          agentRef: { org: "acme", slug: "site-builder" },
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
      agentRef: { org: "acme", slug: "site-builder" },
      harness: Harness.NATIVE,
      executionTarget: ExecutionTarget.LOCAL,
    });
    expect(input.sessionSpec.workspaceEntries).toEqual([
      { name: "site", source: { localPath: { path: "/repos/site" } } },
    ]);
  });

  it("leaves harness and executionTarget undefined when not chosen (server decides)", async () => {
    const { result } = renderHook(() => useCreateAgentRun(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        message: "Hello",
        sessionSpec: { agentRef: { org: "acme", slug: "site-builder" } },
      });
    });

    const input = mockCreate.mock.calls[0][0];
    expect(input.sessionSpec.harness).toBeUndefined();
    expect(input.sessionSpec.executionTarget).toBeUndefined();
  });

  it("passes the metadata map through on the bootstrap spec", async () => {
    const { result } = renderHook(() => useCreateAgentRun(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        message: "Hello",
        sessionSpec: {
          agentRef: { org: "acme", slug: "site-builder" },
          metadata: { "acme/tenant": "t-1" },
        },
      });
    });

    const input = mockCreate.mock.calls[0][0];
    expect(input.sessionSpec.metadata).toEqual({ "acme/tenant": "t-1" });
  });

  it("maps the typed sessionContext onto the reserved metadata key", async () => {
    const { result } = renderHook(() => useCreateAgentRun(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        message: "Hello",
        sessionSpec: {
          agentRef: { org: "acme", slug: "site-builder" },
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
    const { result } = renderHook(() => useCreateAgentRun(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        message: "Hello",
        sessionSpec: {
          agentRef: { org: "acme", slug: "site-builder" },
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
    const { result } = renderHook(() => useCreateAgentRun(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        message: "Hello",
        sessionSpec: { agentRef: { org: "acme", slug: "site-builder" } },
      });
    });

    const input = mockCreate.mock.calls[0][0];
    expect(input.sessionSpec.metadata).toBeUndefined();
  });

  it("returns the server-assigned session id from the bootstrap response", async () => {
    mockCreate.mockResolvedValueOnce({
      metadata: { id: "aex-1" },
      spec: { target: { case: "sessionId", value: "ses-created" } },
    });
    const { result } = renderHook(() => useCreateAgentRun(), {
      wrapper: createWrapper(makeMockClient()),
    });

    let created: { runId: string; sessionId: string } | undefined;
    await act(async () => {
      created = await result.current.create({
        org: "acme",
        message: "Hello",
        sessionSpec: { agentRef: { org: "acme", slug: "site-builder" } },
      });
    });

    expect(created).toEqual({ runId: "aex-1", sessionId: "ses-created" });
  });

  it("echoes the input session id on the existing-session path", async () => {
    const { result } = renderHook(() => useCreateAgentRun(), {
      wrapper: createWrapper(makeMockClient()),
    });

    let created: { runId: string; sessionId: string } | undefined;
    await act(async () => {
      created = await result.current.create({
        org: "acme",
        sessionId: "ses-1",
        message: "Hello",
      });
    });

    expect(created).toEqual({ runId: "aex-1", sessionId: "ses-1" });
  });
});

describe("useCreateAgentRun — supersede link (edit-and-resubmit)", () => {
  it("maps supersedesRunId into the create call", async () => {
    const { result } = renderHook(() => useCreateAgentRun(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        sessionId: "ses-1",
        message: "corrected message",
        supersedesRunId: "aex-old",
      });
    });

    expect(mockCreate.mock.calls[0][0].supersedesRunId).toBe("aex-old");
  });

  it("leaves supersedesRunId undefined for ordinary sends", async () => {
    const { result } = renderHook(() => useCreateAgentRun(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        sessionId: "ses-1",
        message: "Hello",
      });
    });

    expect(mockCreate.mock.calls[0][0].supersedesRunId).toBeUndefined();
  });
});
