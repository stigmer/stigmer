import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { useWorkflowExecutionRailViews } from "../useWorkflowExecutionRailViews";

function artifact(id: string, displayName: string) {
  return create(ArtifactSchema, {
    metadata: { id, name: displayName },
    spec: { displayName, contentType: "application/json" },
  });
}

describe("useWorkflowExecutionRailViews", () => {
  it("always offers the Artifacts view — even with zero artifacts (the panel's only view must exist)", () => {
    const { result } = renderHook(() =>
      useWorkflowExecutionRailViews({
        artifacts: [],
        onOpenArtifact: vi.fn(),
      }),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe("artifacts");
    expect(result.current[0].label).toBe("Artifacts");
    // No badge for an empty list (a zero badge would be noise).
    expect(result.current[0].badge).toBeUndefined();
  });

  it("carries the artifact count as the rail badge", () => {
    const { result } = renderHook(() =>
      useWorkflowExecutionRailViews({
        artifacts: [artifact("art_1", "a.json"), artifact("art_2", "b.json")],
        onOpenArtifact: vi.fn(),
      }),
    );
    expect(result.current[0].badge).toBe(2);
  });

  it("is referentially stable across re-renders with unchanged inputs (DD-010)", () => {
    const onOpenArtifact = vi.fn();
    const artifacts = [artifact("art_1", "a.json")];
    const { result, rerender } = renderHook(() =>
      useWorkflowExecutionRailViews({ artifacts, onOpenArtifact }),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
