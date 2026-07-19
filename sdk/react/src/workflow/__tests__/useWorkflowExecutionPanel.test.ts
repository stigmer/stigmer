import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { FileChangeSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { FileChangeType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ARTIFACT_DOCUMENT_ENTRY_ID } from "../../execution/artifact-document";
import {
  FILE_CHANGE_DOCUMENT_ENTRY_ID,
  fileChangeTabPath,
} from "../../execution/file-change-document";
import {
  DIAGNOSIS_DOCUMENT_ENTRY_ID,
  DIAGNOSIS_DOCUMENT_PATH,
} from "../diagnosis-document";
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

function fileChange(path: string) {
  return create(FileChangeSchema, { path, changeType: FileChangeType.MODIFY });
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

describe("fileChangeTabPath", () => {
  it("uses the change's path so the tab LABEL is the file's basename", () => {
    expect(fileChangeTabPath(fileChange("src/app/page.tsx"))).toBe(
      "src/app/page.tsx",
    );
  });

  it("falls back to absolutePath for captures without a workspace-relative path", () => {
    const c = create(FileChangeSchema, {
      path: "",
      absolutePath: "/tmp/scratch.txt",
      changeType: FileChangeType.MODIFY,
    });
    expect(fileChangeTabPath(c)).toBe("/tmp/scratch.txt");
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

  it("openFileChange opens a preview tab in the file-change family and expands the panel", () => {
    const { result } = renderHook(() => useWorkflowExecutionPanel());
    const c = fileChange("src/app/page.tsx");

    act(() => result.current.openFileChange(c));

    expect(result.current.isOpen).toBe(true);
    const { editors } = result.current.editorsStore.getSnapshot();
    expect(editors).toEqual([
      {
        entryId: FILE_CHANGE_DOCUMENT_ENTRY_ID,
        path: "src/app/page.tsx",
        preview: true,
      },
    ]);
  });

  it("the preview slot is shared ACROSS families — browsing a change then an artifact reuses one tab", () => {
    const { result } = renderHook(() => useWorkflowExecutionPanel());

    act(() => {
      result.current.openFileChange(fileChange("src/a.ts"));
      result.current.openArtifact(artifact("art_1", "report.json"));
    });

    const { editors } = result.current.editorsStore.getSnapshot();
    expect(editors).toHaveLength(1);
    expect(editors[0].entryId).toBe(ARTIFACT_DOCUMENT_ENTRY_ID);
  });

  it("pinFileChange makes the change's tab persistent", () => {
    const { result } = renderHook(() => useWorkflowExecutionPanel());
    const c = fileChange("src/a.ts");

    act(() => {
      result.current.openFileChange(c);
      result.current.pinFileChange(c);
    });

    const { editors } = result.current.editorsStore.getSnapshot();
    expect(editors[0].preview).toBe(false);
  });

  it("a same-named change and artifact never collide (distinct virtual families)", () => {
    const { result } = renderHook(() => useWorkflowExecutionPanel());
    const c = fileChange("report.json");
    const a = artifact("art_1", "report.json");

    act(() => {
      result.current.openFileChange(c);
      result.current.pinFileChange(c);
      result.current.openArtifact(a);
    });

    const { editors } = result.current.editorsStore.getSnapshot();
    expect(editors).toHaveLength(2);
    expect(new Set(editors.map((e) => e.entryId)).size).toBe(2);
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

// ---------------------------------------------------------------------------
// Diagnosis document (singleton editor tab — the tab IS the active state)
// ---------------------------------------------------------------------------

describe("useWorkflowExecutionPanel openDiagnosis", () => {
  it("opens the diagnosis document as a pinned tab and expands the panel", () => {
    const { result } = renderHook(() => useWorkflowExecutionPanel());

    act(() => result.current.openDiagnosis());

    expect(result.current.isOpen).toBe(true);
    expect(result.current.editorsStore.getSnapshot().editors).toEqual([
      {
        entryId: DIAGNOSIS_DOCUMENT_ENTRY_ID,
        path: DIAGNOSIS_DOCUMENT_PATH,
        preview: false,
      },
    ]);
  });

  it("re-invoking Diagnose focuses the existing tab — never a duplicate (singleton)", () => {
    const { result } = renderHook(() => useWorkflowExecutionPanel());

    act(() => {
      result.current.openDiagnosis();
      result.current.openDiagnosis();
    });

    expect(result.current.editorsStore.getSnapshot().editors).toHaveLength(1);
  });

  it("the pinned diagnosis tab survives preview browsing (artifacts reuse their own slot)", () => {
    const { result } = renderHook(() => useWorkflowExecutionPanel());

    act(() => {
      result.current.openDiagnosis();
      result.current.openArtifact(artifact("art_1", "report.json"));
    });

    const { editors } = result.current.editorsStore.getSnapshot();
    expect(editors).toHaveLength(2);
    expect(editors.map((e) => e.entryId)).toContain(
      DIAGNOSIS_DOCUMENT_ENTRY_ID,
    );
  });
});
