import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { ARTIFACT_DOCUMENT_ENTRY_ID } from "../../execution/artifact-document";
import {
  useWorkflowExecutionPanel,
  workflowArtifactTabPath,
} from "../useWorkflowExecutionPanel";

function artifact(id: string, displayName: string) {
  return create(ArtifactSchema, {
    metadata: { id, name: displayName },
    spec: { displayName, contentType: "application/json" },
  });
}

describe("workflowArtifactTabPath", () => {
  it("combines the immutable id with the display name so the tab LABEL is the basename", () => {
    expect(workflowArtifactTabPath(artifact("art_1", "report.json"))).toBe(
      "art_1/report.json",
    );
  });

  it("gives distinct identities to same-named artifacts from different tasks", () => {
    const a = workflowArtifactTabPath(artifact("art_1", "output.json"));
    const b = workflowArtifactTabPath(artifact("art_2", "output.json"));
    expect(a).not.toBe(b);
  });
});

describe("useWorkflowExecutionPanel", () => {
  it("starts collapsed on the artifacts view", () => {
    const { result } = renderHook(() => useWorkflowExecutionPanel());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.view).toBe("artifacts");
  });

  it("opens and closes, preserving the view", () => {
    const { result } = renderHook(() => useWorkflowExecutionPanel());
    act(() => result.current.openPanel());
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.closePanel());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.view).toBe("artifacts");
  });

  it("openArtifact opens a preview tab in the shared artifact family and expands the panel", () => {
    const { result } = renderHook(() => useWorkflowExecutionPanel());
    const a = artifact("art_1", "report.json");

    act(() => result.current.openArtifact(a));

    expect(result.current.isOpen).toBe(true);
    const { editors } = result.current.editorsStore.getSnapshot();
    expect(editors).toEqual([
      {
        entryId: ARTIFACT_DOCUMENT_ENTRY_ID,
        path: "art_1/report.json",
        preview: true,
      },
    ]);
  });

  it("browsing artifacts reuses the one preview tab; pinArtifact makes it persistent", () => {
    const { result } = renderHook(() => useWorkflowExecutionPanel());
    const a = artifact("art_1", "a.json");
    const b = artifact("art_2", "b.json");

    act(() => {
      result.current.openArtifact(a);
      result.current.openArtifact(b);
    });
    // Preview-tab semantics: the second open replaced the first.
    expect(result.current.editorsStore.getSnapshot().editors).toHaveLength(1);
    expect(
      result.current.editorsStore.getSnapshot().editors[0].path,
    ).toBe("art_2/b.json");

    act(() => result.current.pinArtifact(b));
    expect(
      result.current.editorsStore.getSnapshot().editors[0].preview,
    ).toBe(false);
  });

  it("closing an editor keeps the panel open (the panel is more than tabs)", () => {
    const { result } = renderHook(() => useWorkflowExecutionPanel());
    const a = artifact("art_1", "a.json");
    act(() => result.current.openArtifact(a));
    act(() =>
      result.current.closeEditor(ARTIFACT_DOCUMENT_ENTRY_ID, "art_1/a.json"),
    );
    expect(result.current.editorsStore.getSnapshot().editors).toHaveLength(0);
    expect(result.current.isOpen).toBe(true);
  });

  it("honors a custom default view", () => {
    const { result } = renderHook(() =>
      useWorkflowExecutionPanel({ defaultView: "usage" }),
    );
    expect(result.current.view).toBe("usage");
  });
});
