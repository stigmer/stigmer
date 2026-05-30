import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  useSessionInspector,
  buildVisibleTabs,
  type UseSessionInspectorOptions,
} from "../useSessionInspector";

function defaultOpts(overrides?: Partial<UseSessionInspectorOptions>): UseSessionInspectorOptions {
  return {
    phase: null,
    hasWriteBacks: false,
    writeBackCount: 0,
    hasArtifacts: false,
    artifactCount: 0,
    hasUsage: false,
    selectedItem: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildVisibleTabs
// ---------------------------------------------------------------------------

describe("buildVisibleTabs", () => {
  it("always includes Workspace, Config, Plan, and Usage", () => {
    const tabs = buildVisibleTabs({
      hasWriteBacks: false,
      writeBackCount: 0,
      hasArtifacts: false,
      artifactCount: 0,
      hasUsage: false,
      selectedItem: null,
    });
    const ids = tabs.map((t) => t.id);
    expect(ids).toContain("workspace");
    expect(ids).toContain("configure");
    expect(ids).toContain("plan");
    expect(ids).toContain("usage");
    expect(ids).not.toContain("changes");
    expect(ids).not.toContain("artifacts");
    expect(ids).not.toContain("inspect");

    const configTab = tabs.find((t) => t.id === "configure");
    expect(configTab?.label).toBe("Config");
  });

  it("includes Changes with badge when write-backs exist", () => {
    const tabs = buildVisibleTabs({
      hasWriteBacks: true,
      writeBackCount: 3,
      hasArtifacts: false,
      artifactCount: 0,
      hasUsage: false,
      selectedItem: null,
    });
    const changesTab = tabs.find((t) => t.id === "changes");
    expect(changesTab).toBeDefined();
    expect(changesTab?.badge).toBe(3);
  });

  it("includes Artifacts with badge when artifacts exist", () => {
    const tabs = buildVisibleTabs({
      hasWriteBacks: false,
      writeBackCount: 0,
      hasArtifacts: true,
      artifactCount: 7,
      hasUsage: false,
      selectedItem: null,
    });
    const artifactsTab = tabs.find((t) => t.id === "artifacts");
    expect(artifactsTab).toBeDefined();
    expect(artifactsTab?.badge).toBe(7);
  });

  it("includes Inspect when a thread item is selected", () => {
    const tabs = buildVisibleTabs({
      hasWriteBacks: false,
      writeBackCount: 0,
      hasArtifacts: false,
      artifactCount: 0,
      hasUsage: false,
      selectedItem: { kind: "tool-call", toolCallId: "tc-1" },
    });
    const inspectTab = tabs.find((t) => t.id === "inspect");
    expect(inspectTab).toBeDefined();
  });

  it("orders tabs as Workspace, Config, Plan, then Usage with Inspect last", () => {
    const tabs = buildVisibleTabs({
      hasWriteBacks: true,
      writeBackCount: 2,
      hasArtifacts: true,
      artifactCount: 1,
      hasUsage: true,
      selectedItem: { kind: "tool-call", toolCallId: "tc-1" },
    });
    const ids = tabs.map((t) => t.id);
    expect(ids.indexOf("workspace")).toBeLessThan(ids.indexOf("configure"));
    expect(ids.indexOf("configure")).toBeLessThan(ids.indexOf("plan"));
    expect(ids.indexOf("plan")).toBeLessThan(ids.indexOf("usage"));
    expect(ids.indexOf("usage")).toBeLessThan(ids.indexOf("inspect"));
  });

  it("base tabs are present even when no optional tabs exist", () => {
    const tabs = buildVisibleTabs({
      hasWriteBacks: false,
      writeBackCount: 0,
      hasArtifacts: false,
      artifactCount: 0,
      hasUsage: false,
      selectedItem: null,
    });
    const ids = tabs.map((t) => t.id);
    expect(ids).toEqual(["workspace", "configure", "plan", "usage"]);
  });
});

// ---------------------------------------------------------------------------
// useSessionInspector FSM
// ---------------------------------------------------------------------------

describe("useSessionInspector", () => {
  it("defaults to workspace when no execution is active (phase=null)", () => {
    const { result } = renderHook(() => useSessionInspector(defaultOpts()));
    expect(result.current.activeTab).toBe("workspace");
  });

  it("defaults to workspace when execution is terminal", () => {
    const { result } = renderHook(() =>
      useSessionInspector(
        defaultOpts({ phase: ExecutionPhase.EXECUTION_COMPLETED }),
      ),
    );
    expect(result.current.activeTab).toBe("workspace");
  });

  it("defaults to plan while execution is running", () => {
    const { result } = renderHook(() =>
      useSessionInspector(
        defaultOpts({ phase: ExecutionPhase.EXECUTION_IN_PROGRESS }),
      ),
    );
    expect(result.current.activeTab).toBe("plan");
  });

  it("auto-switches to inspect when a thread item is selected", () => {
    const { result, rerender } = renderHook(
      (props: UseSessionInspectorOptions) => useSessionInspector(props),
      { initialProps: defaultOpts() },
    );
    expect(result.current.activeTab).toBe("workspace");

    rerender(
      defaultOpts({ selectedItem: { kind: "tool-call", toolCallId: "tc-1" } }),
    );
    expect(result.current.activeTab).toBe("inspect");
  });

  it("reverts to workspace when selection is cleared (phase=null) and user did not pick a tab", () => {
    const { result, rerender } = renderHook(
      (props: UseSessionInspectorOptions) => useSessionInspector(props),
      {
        initialProps: defaultOpts({
          selectedItem: { kind: "tool-call", toolCallId: "tc-1" },
        }),
      },
    );
    expect(result.current.activeTab).toBe("inspect");

    rerender(defaultOpts({ selectedItem: null }));
    expect(result.current.activeTab).toBe("workspace");
  });

  it("reverts to plan when selection is cleared while execution is running", () => {
    const { result, rerender } = renderHook(
      (props: UseSessionInspectorOptions) => useSessionInspector(props),
      {
        initialProps: defaultOpts({
          phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
          selectedItem: { kind: "tool-call", toolCallId: "tc-1" },
        }),
      },
    );
    expect(result.current.activeTab).toBe("inspect");

    rerender(
      defaultOpts({
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        selectedItem: null,
      }),
    );
    expect(result.current.activeTab).toBe("plan");
  });

  it("keeps user-picked tab sticky", () => {
    const { result, rerender } = renderHook(
      (props: UseSessionInspectorOptions) => useSessionInspector(props),
      { initialProps: defaultOpts({ hasUsage: true }) },
    );

    act(() => {
      result.current.onTabChange("usage");
    });
    expect(result.current.activeTab).toBe("usage");

    rerender(
      defaultOpts({
        hasUsage: true,
        selectedItem: { kind: "tool-call", toolCallId: "tc-1" },
      }),
    );
    expect(result.current.activeTab).toBe("usage");
  });

  it("auto-switches to changes when first write-back arrives", () => {
    const { result, rerender } = renderHook(
      (props: UseSessionInspectorOptions) => useSessionInspector(props),
      { initialProps: defaultOpts() },
    );
    expect(result.current.activeTab).toBe("workspace");

    rerender(
      defaultOpts({ hasWriteBacks: true, writeBackCount: 1 }),
    );
    expect(result.current.activeTab).toBe("changes");
  });

  it("falls back to workspace when active tab is removed from visible tabs (phase=null)", () => {
    const { result, rerender } = renderHook(
      (props: UseSessionInspectorOptions) => useSessionInspector(props),
      {
        initialProps: defaultOpts({
          selectedItem: { kind: "tool-call", toolCallId: "tc-1" },
        }),
      },
    );
    expect(result.current.activeTab).toBe("inspect");

    act(() => {
      result.current.onTabChange("inspect");
    });

    rerender(defaultOpts({ selectedItem: null }));
    expect(result.current.activeTab).toBe("workspace");
  });

  it("switches to workspace when execution transitions to terminal phase", () => {
    const { result, rerender } = renderHook(
      (props: UseSessionInspectorOptions) => useSessionInspector(props),
      {
        initialProps: defaultOpts({
          phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        }),
      },
    );
    expect(result.current.activeTab).toBe("plan");

    rerender(
      defaultOpts({ phase: ExecutionPhase.EXECUTION_COMPLETED }),
    );
    expect(result.current.activeTab).toBe("workspace");
  });
});
