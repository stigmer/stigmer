import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ExecutionTargetContext } from "../../execution-target-context";
import { DeploymentModeContext } from "../../deployment-mode";
import { useWorkspaceSources } from "../useWorkspaceSources";
import type { ExecutionTargetOption } from "../../session/execution-target";
import type { DeploymentMode } from "@stigmer/sdk";

function wrapper({
  executionTarget,
  deploymentMode = "cloud",
}: {
  executionTarget?: ExecutionTargetOption;
  deploymentMode?: DeploymentMode;
}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DeploymentModeContext.Provider value={deploymentMode}>
        <ExecutionTargetContext.Provider value={executionTarget}>
          {children}
        </ExecutionTargetContext.Provider>
      </DeploymentModeContext.Provider>
    );
  };
}

describe("useWorkspaceSources", () => {
  // -----------------------------------------------------------------------
  // Cloud execution target
  // -----------------------------------------------------------------------

  it("returns GitHub only when execution target is cloud", () => {
    const { result } = renderHook(() => useWorkspaceSources(), {
      wrapper: wrapper({ executionTarget: "cloud" }),
    });

    expect(result.current).toEqual({
      enableGitHub: true,
      enableLocal: false,
    });
  });

  it("returns GitHub only when execution target is cloud, even with hasLocalPicker", () => {
    const { result } = renderHook(
      () => useWorkspaceSources({ hasLocalPicker: true }),
      { wrapper: wrapper({ executionTarget: "cloud" }) },
    );

    expect(result.current).toEqual({
      enableGitHub: true,
      enableLocal: false,
    });
  });

  // -----------------------------------------------------------------------
  // Local execution target
  // -----------------------------------------------------------------------

  it("returns local only when execution target is local and hasLocalPicker", () => {
    const { result } = renderHook(
      () => useWorkspaceSources({ hasLocalPicker: true }),
      { wrapper: wrapper({ executionTarget: "local" }) },
    );

    expect(result.current).toEqual({
      enableGitHub: false,
      enableLocal: true,
    });
  });

  it("returns both (GitHub fallback) when execution target is local and no local picker", () => {
    const { result } = renderHook(() => useWorkspaceSources(), {
      wrapper: wrapper({ executionTarget: "local" }),
    });

    expect(result.current).toEqual({
      enableGitHub: true,
      enableLocal: true,
    });
  });

  it("returns both (GitHub fallback) when execution target is local and hasLocalPicker is false", () => {
    const { result } = renderHook(
      () => useWorkspaceSources({ hasLocalPicker: false }),
      { wrapper: wrapper({ executionTarget: "local" }) },
    );

    expect(result.current).toEqual({
      enableGitHub: true,
      enableLocal: true,
    });
  });

  // -----------------------------------------------------------------------
  // No explicit execution target — falls back to deployment mode
  // -----------------------------------------------------------------------

  it("falls back to cloud deployment mode when no execution target is set", () => {
    const { result } = renderHook(() => useWorkspaceSources(), {
      wrapper: wrapper({ executionTarget: undefined, deploymentMode: "cloud" }),
    });

    expect(result.current).toEqual({
      enableGitHub: true,
      enableLocal: false,
    });
  });

  it("falls back to local deployment mode when no execution target is set", () => {
    const { result } = renderHook(() => useWorkspaceSources(), {
      wrapper: wrapper({ executionTarget: undefined, deploymentMode: "local" }),
    });

    expect(result.current).toEqual({
      enableGitHub: true,
      enableLocal: true,
    });
  });

  it("falls back to local deployment mode with hasLocalPicker", () => {
    const { result } = renderHook(
      () => useWorkspaceSources({ hasLocalPicker: true }),
      { wrapper: wrapper({ executionTarget: undefined, deploymentMode: "local" }) },
    );

    expect(result.current).toEqual({
      enableGitHub: false,
      enableLocal: true,
    });
  });

  // -----------------------------------------------------------------------
  // Reference stability
  // -----------------------------------------------------------------------

  it("returns the same object reference across re-renders when inputs are unchanged", () => {
    const { result, rerender } = renderHook(() => useWorkspaceSources(), {
      wrapper: wrapper({ executionTarget: "cloud" }),
    });

    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
