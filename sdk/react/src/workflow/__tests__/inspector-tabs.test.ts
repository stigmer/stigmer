import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInspectorTabs } from "../inspector/useInspectorTabs";
import type { TaskKindDescriptor } from "../types";

function makeDescriptor(overrides?: Partial<TaskKindDescriptor>): TaskKindDescriptor {
  return {
    kind: "agent_call",
    displayName: "Agent Call",
    description: "Invoke an AI agent",
    category: "ai",
    icon: "brain",
    configProtoType: "AgentCallTaskConfig",
    fields: [],
    fieldGroups: [],
    configJsonSchema: {},
    documentationUrl: "/docs/agent-call",
    isAiNative: true,
    requiresExternalService: false,
    ...overrides,
  };
}

describe("useInspectorTabs", () => {
  it("returns empty tabs when kindString is null", () => {
    const { result } = renderHook(() =>
      useInspectorTabs({ kindString: null, descriptor: undefined, mode: "design", nodeId: null }),
    );
    expect(result.current.tabs).toHaveLength(0);
  });

  it("returns empty tabs in execution mode", () => {
    const { result } = renderHook(() =>
      useInspectorTabs({ kindString: "agent_call", descriptor: makeDescriptor(), mode: "execution", nodeId: "n1" }),
    );
    expect(result.current.tabs).toHaveLength(0);
  });

  it("shows Configure, Data, Runtime, Advanced, Docs for agent_call with docs", () => {
    const desc = makeDescriptor({ yamlExamples: ["example: yaml"] });
    const { result } = renderHook(() =>
      useInspectorTabs({ kindString: "agent_call", descriptor: desc, mode: "design", nodeId: "n1" }),
    );
    const ids = result.current.tabs.map((t) => t.id);
    expect(ids).toEqual(["configure", "data", "runtime", "advanced", "docs"]);
  });

  it("shows Configure, Data, Runtime, Advanced for http_call without docs", () => {
    const desc = makeDescriptor({
      kind: "http_call",
      category: "invocation",
      documentationUrl: "",
      yamlExamples: undefined,
    });
    const { result } = renderHook(() =>
      useInspectorTabs({ kindString: "http_call", descriptor: desc, mode: "design", nodeId: "n2" }),
    );
    const ids = result.current.tabs.map((t) => t.id);
    expect(ids).toEqual(["configure", "data", "runtime", "advanced"]);
  });

  it("shows Configure, Data, Advanced for set_vars (no Runtime)", () => {
    const desc = makeDescriptor({
      kind: "set_vars",
      category: "data",
      documentationUrl: "",
    });
    const { result } = renderHook(() =>
      useInspectorTabs({ kindString: "set_vars", descriptor: desc, mode: "design", nodeId: "n3" }),
    );
    const ids = result.current.tabs.map((t) => t.id);
    expect(ids).toEqual(["configure", "data", "advanced"]);
  });

  it("shows Runtime for fork (container kind)", () => {
    const desc = makeDescriptor({ kind: "fork", category: "control_flow", documentationUrl: "" });
    const { result } = renderHook(() =>
      useInspectorTabs({ kindString: "fork", descriptor: desc, mode: "design", nodeId: "n4" }),
    );
    const ids = result.current.tabs.map((t) => t.id);
    expect(ids).toContain("runtime");
  });

  it("defaults to configure tab", () => {
    const { result } = renderHook(() =>
      useInspectorTabs({ kindString: "agent_call", descriptor: makeDescriptor(), mode: "design", nodeId: "n1" }),
    );
    expect(result.current.activeTab).toBe("configure");
  });

  it("resets to configure when nodeId changes", () => {
    const { result, rerender } = renderHook(
      ({ nodeId }) =>
        useInspectorTabs({ kindString: "agent_call", descriptor: makeDescriptor(), mode: "design", nodeId }),
      { initialProps: { nodeId: "n1" } },
    );

    act(() => result.current.setActiveTab("advanced"));
    expect(result.current.activeTab).toBe("advanced");

    rerender({ nodeId: "n2" });
    expect(result.current.activeTab).toBe("configure");
  });

  it("preserves tab when nodeId stays the same on rerender", () => {
    const { result, rerender } = renderHook(
      ({ nodeId }) =>
        useInspectorTabs({ kindString: "agent_call", descriptor: makeDescriptor(), mode: "design", nodeId }),
      { initialProps: { nodeId: "n1" } },
    );

    act(() => result.current.setActiveTab("data"));
    rerender({ nodeId: "n1" });
    expect(result.current.activeTab).toBe("data");
  });
});
