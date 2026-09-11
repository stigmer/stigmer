/**
 * Pins the React side of the edition vocabulary: `useDeploymentMode` reads
 * the provider's context (default "cloud"), and `useResourceAvailable`
 * answers the tier question for the third edition — an enterprise-tier
 * kind is served, a cloud_only kind is not. The rank logic itself is pinned
 * in @stigmer/sdk (`resource-availability.test.ts`); this proves the hook
 * threads the context value through without narrowing it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DeploymentMode } from "@stigmer/sdk";
import {
  ApiResourceKind,
  DeploymentModeContext,
  useDeploymentMode,
  useResourceAvailable,
} from "../deployment-mode";

function wrapper(mode: DeploymentMode) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DeploymentModeContext.Provider value={mode}>
        {children}
      </DeploymentModeContext.Provider>
    );
  };
}

afterEach(cleanup);

describe("useDeploymentMode", () => {
  it("defaults to cloud when no provider sets it", () => {
    const { result } = renderHook(() => useDeploymentMode());
    expect(result.current).toBe("cloud");
  });

  it("reads enterprise from the provider", () => {
    const { result } = renderHook(() => useDeploymentMode(), {
      wrapper: wrapper("enterprise"),
    });
    expect(result.current).toBe("enterprise");
  });
});

describe("useResourceAvailable under the enterprise mode", () => {
  it("serves an enterprise-tier kind", () => {
    const { result } = renderHook(
      () => useResourceAvailable(ApiResourceKind.iam_policy),
      { wrapper: wrapper("enterprise") },
    );
    expect(result.current).toBe(true);
  });

  it("does not serve a cloud_only-tier kind", () => {
    const { result } = renderHook(
      () => useResourceAvailable(ApiResourceKind.api_resource_version),
      { wrapper: wrapper("enterprise") },
    );
    expect(result.current).toBe(false);
  });

  it("serves every open_source-tier kind, like every mode does", () => {
    const { result } = renderHook(
      () => useResourceAvailable(ApiResourceKind.agent),
      { wrapper: wrapper("enterprise") },
    );
    expect(result.current).toBe(true);
  });
});
