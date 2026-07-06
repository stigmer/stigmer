import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  ExecutionArtifactKind,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { useSessionPanel, type UseSessionPanelOptions } from "../useSessionPanel";
import { PLAN_DOCUMENT_ENTRY_ID, PLAN_DOCUMENT_PATH } from "../plan-document";
import { ARTIFACT_DOCUMENT_ENTRY_ID } from "../artifact-document";
import { artifactKey } from "../useSessionArtifacts";
import type { SelectedThreadItem } from "../../internal/store/selection-store";

// ---------------------------------------------------------------------------
// The unified-panel controller: collapsed-by-default state, the open-editor
// group, and the rail-view FSM ported from the retired inspector tabs. The
// FSM rules under test: explicit picks are sticky; auto-switching happens only
// in an OPEN panel (arrivals/selections never auto-open); running⇄terminal
// transitions reset stickiness.
// ---------------------------------------------------------------------------

const item = { kind: "toolCall" } as unknown as SelectedThreadItem;

function renderPanel(initial?: Partial<UseSessionPanelOptions>) {
  return renderHook(
    (opts: UseSessionPanelOptions) => useSessionPanel(opts),
    {
      initialProps: {
        phase: null,
        hasChanges: false,
        ...initial,
      } as UseSessionPanelOptions,
    },
  );
}

afterEach(cleanup);

describe("useSessionPanel — open/collapse", () => {
  it("starts collapsed on the Explorer view", () => {
    const { result } = renderPanel();
    expect(result.current.isOpen).toBe(false);
    expect(result.current.view).toBe("files");
  });

  it("opens via openPanel and collapses via closePanel, preserving the view", () => {
    const { result } = renderPanel();
    act(() => result.current.openPanel());
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.setView("usage"));
    act(() => result.current.closePanel());
    expect(result.current.isOpen).toBe(false);
    act(() => result.current.openPanel());
    expect(result.current.view).toBe("usage");
  });

  it("openFile opens the panel with a preview tab", () => {
    const { result } = renderPanel();
    act(() => result.current.openFile("e1", "src/main.go"));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.editorsStore.getSnapshot().editors).toEqual([
      { entryId: "e1", path: "src/main.go", preview: true },
    ]);
  });

  it("keeps the panel open when the last editor closes (the panel is more than files)", () => {
    const { result } = renderPanel();
    act(() => result.current.openFile("e1", "a.ts"));
    act(() => result.current.closeEditor("e1", "a.ts"));
    expect(result.current.editorsStore.getSnapshot().editors).toEqual([]);
    expect(result.current.isOpen).toBe(true);
  });
});

describe("useSessionPanel — selection (Inspect)", () => {
  it("auto-surfaces Inspect for a selection while the panel is open", () => {
    const { result } = renderPanel();
    act(() => result.current.openPanel());
    act(() => result.current.notifySelection(item));
    expect(result.current.view).toBe("inspect");
  });

  it("never auto-opens a collapsed panel on selection", () => {
    const { result } = renderPanel();
    act(() => result.current.notifySelection(item));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.view).toBe("files");
  });

  it("surfaces a selection made while collapsed when the panel opens", () => {
    const { result } = renderPanel();
    act(() => result.current.notifySelection(item));
    act(() => result.current.openPanel());
    expect(result.current.view).toBe("inspect");
  });

  it("yields to an explicit pick (sticky) over selection auto-switch", () => {
    const { result } = renderPanel();
    act(() => result.current.openPanel());
    act(() => result.current.setView("usage"));
    act(() => result.current.notifySelection(item));
    expect(result.current.view).toBe("usage");
  });

  it("leaves Inspect (and unsticks) when the selection clears", () => {
    const { result } = renderPanel();
    act(() => result.current.openPanel());
    act(() => result.current.notifySelection(item));
    expect(result.current.view).toBe("inspect");
    act(() => result.current.notifySelection(null));
    expect(result.current.view).toBe("files");
    // Unstuck: the next selection auto-surfaces Inspect again.
    act(() => result.current.notifySelection(item));
    expect(result.current.view).toBe("inspect");
  });
});

describe("useSessionPanel — arrivals and phase", () => {
  it("auto-surfaces Changes on first write-back while the panel is open", () => {
    const { result, rerender } = renderPanel();
    act(() => result.current.openPanel());
    rerender({ phase: null, hasChanges: true });
    expect(result.current.view).toBe("changes");
  });

  it("never auto-opens (or re-routes) a collapsed panel on a write-back — badge only", () => {
    const { result, rerender } = renderPanel();
    rerender({ phase: null, hasChanges: true });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.view).toBe("files");
  });

  it("respects a sticky pick when a write-back arrives", () => {
    const { result, rerender } = renderPanel();
    act(() => result.current.openPanel());
    act(() => result.current.setView("usage"));
    rerender({ phase: null, hasChanges: true });
    expect(result.current.view).toBe("usage");
  });

  it("resets the sticky pick on a running→terminal transition", () => {
    const { result, rerender } = renderPanel({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    act(() => result.current.openPanel());
    act(() => result.current.setView("usage"));
    rerender({
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      hasChanges: false,
    });
    expect(result.current.view).toBe("files");
    // Unstuck: a selection now auto-surfaces Inspect.
    act(() => result.current.notifySelection(item));
    expect(result.current.view).toBe("inspect");
  });
});

describe("useSessionPanel — plan document tab", () => {
  const planTab = {
    entryId: PLAN_DOCUMENT_ENTRY_ID,
    path: PLAN_DOCUMENT_PATH,
    preview: false,
  };

  function planEditors(result: { current: ReturnType<typeof useSessionPanel> }) {
    return result.current.editorsStore.getSnapshot().editors;
  }

  it("openPlanDocument opens the panel with a pinned plan tab", () => {
    const { result } = renderPanel();
    act(() => result.current.openPlanDocument());
    expect(result.current.isOpen).toBe(true);
    expect(planEditors(result)).toEqual([planTab]);
  });

  it("keeps the plan tab pinned across preview browsing (never evicted)", () => {
    const { result } = renderPanel();
    act(() => result.current.openPlanDocument());
    // Preview browsing reuses the single preview slot; the pinned plan tab
    // must survive it untouched.
    act(() => result.current.openFile("e1", "a.ts"));
    act(() => result.current.openFile("e1", "b.ts"));
    expect(planEditors(result)).toEqual([
      planTab,
      { entryId: "e1", path: "b.ts", preview: true },
    ]);
  });

  it("auto-opens the plan tab when a plan arrives — even from a collapsed panel", () => {
    // The one deliberate exception to the "never open a collapsed panel"
    // arrival convention: a completing plan is the turn's deliverable, and
    // with the thread showing only a compact card there is no other review
    // surface.
    const { result, rerender } = renderPanel();
    expect(result.current.isOpen).toBe(false);
    rerender({ phase: null, hasChanges: false, planKey: "e1:hash-a" });
    expect(result.current.isOpen).toBe(true);
    expect(planEditors(result)).toEqual([planTab]);
  });

  it("activates (focuses) the plan tab on arrival, over the open file", () => {
    const { result, rerender } = renderPanel();
    act(() => result.current.openFile("e1", "a.ts"));
    rerender({ phase: null, hasChanges: false, planKey: "e1:hash-a" });
    const { activeFile } = result.current.editorsStore.getSnapshot();
    expect(activeFile).toEqual({
      entryId: PLAN_DOCUMENT_ENTRY_ID,
      path: PLAN_DOCUMENT_PATH,
    });
  });

  it("re-opens the plan tab when a refined plan supersedes the current one (new identity)", () => {
    const { result, rerender } = renderPanel();
    rerender({ phase: null, hasChanges: false, planKey: "e1:hash-a" });
    act(() =>
      result.current.closeEditor(PLAN_DOCUMENT_ENTRY_ID, PLAN_DOCUMENT_PATH),
    );
    expect(planEditors(result)).toEqual([]);
    rerender({ phase: null, hasChanges: false, planKey: "e2:hash-b" });
    expect(planEditors(result)).toEqual([planTab]);
  });

  it("opens on the streaming identity, then idempotently re-fires when the plan publishes", () => {
    // The viewer feeds `<executionId>:streaming` while the plan is being
    // written, then the artifact identity once published — two identities,
    // one pinned tab: the transition must not duplicate it or disturb it.
    const { result, rerender } = renderPanel();
    rerender({ phase: null, hasChanges: false, planKey: "e1:streaming" });
    expect(result.current.isOpen).toBe(true);
    expect(planEditors(result)).toEqual([planTab]);
    rerender({ phase: null, hasChanges: false, planKey: "e1:hash-a" });
    expect(planEditors(result)).toEqual([planTab]);
  });

  it("does not re-open the plan tab for an unchanged identity", () => {
    const { result, rerender } = renderPanel();
    rerender({ phase: null, hasChanges: false, planKey: "e1:hash-a" });
    act(() =>
      result.current.closeEditor(PLAN_DOCUMENT_ENTRY_ID, PLAN_DOCUMENT_PATH),
    );
    rerender({ phase: null, hasChanges: false, planKey: "e1:hash-a" });
    expect(planEditors(result)).toEqual([]);
  });

  it("does not open anything for a plan that existed at mount", () => {
    // Loading a session with an old plan must not hijack the layout.
    const { result, rerender } = renderPanel({ planKey: "e1:hash-a" });
    expect(result.current.isOpen).toBe(false);
    expect(planEditors(result)).toEqual([]);
    // …and the mount identity doesn't count as "new" on later rerenders.
    rerender({ phase: null, hasChanges: false, planKey: "e1:hash-a" });
    expect(planEditors(result)).toEqual([]);
  });

  it("leaves the rail view alone (the tab lives in the editor area)", () => {
    const { result, rerender } = renderPanel();
    act(() => result.current.openPanel());
    act(() => result.current.setView("usage"));
    rerender({ phase: null, hasChanges: false, planKey: "e1:hash-a" });
    expect(result.current.view).toBe("usage");
  });
});

describe("useSessionPanel — artifact document tabs", () => {
  function artifact(sandboxPath: string, name: string) {
    return create(ExecutionArtifactSchema, {
      name,
      kind: ExecutionArtifactKind.FILE,
      sandboxPath,
      storageKey: `artifacts/aex_1/${name}`,
    });
  }

  it("openArtifact opens the panel with a PREVIEW tab keyed by artifactKey", () => {
    const { result } = renderPanel();
    const a = artifact(".stigmer/notes.md", "notes.md");
    act(() => result.current.openArtifact(a));

    expect(result.current.isOpen).toBe(true);
    expect(result.current.editorsStore.getSnapshot().editors).toEqual([
      { entryId: ARTIFACT_DOCUMENT_ENTRY_ID, path: artifactKey(a), preview: true },
    ]);
  });

  it("reuses the single preview slot as different artifacts are browsed", () => {
    const { result } = renderPanel();
    act(() => result.current.openArtifact(artifact(".stigmer/a.md", "a.md")));
    act(() => result.current.openArtifact(artifact(".stigmer/b.md", "b.md")));

    // VS Code preview semantics: single-click browsing reuses one tab.
    expect(result.current.editorsStore.getSnapshot().editors).toEqual([
      { entryId: ARTIFACT_DOCUMENT_ENTRY_ID, path: ".stigmer/b.md", preview: true },
    ]);
  });

  it("does not evict a pinned plan tab when an artifact opens", () => {
    const { result } = renderPanel();
    act(() => result.current.openPlanDocument());
    act(() => result.current.openArtifact(artifact(".stigmer/a.md", "a.md")));

    expect(result.current.editorsStore.getSnapshot().editors).toEqual([
      { entryId: PLAN_DOCUMENT_ENTRY_ID, path: PLAN_DOCUMENT_PATH, preview: false },
      { entryId: ARTIFACT_DOCUMENT_ENTRY_ID, path: ".stigmer/a.md", preview: true },
    ]);
  });
});

describe("useSessionPanel — defaultView (home view)", () => {
  it("seeds the view to the provided defaultView (launcher homes on Config)", () => {
    const { result } = renderPanel({ defaultView: "configure" });
    expect(result.current.view).toBe("configure");
  });

  it("returns to defaultView (not files) on a running→terminal reset", () => {
    const { result, rerender } = renderPanel({
      defaultView: "configure",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    act(() => result.current.openPanel());
    act(() => result.current.setView("usage"));
    rerender({
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      hasChanges: false,
      defaultView: "configure",
    });
    expect(result.current.view).toBe("configure");
  });

  it("returns to defaultView (not files) when a selection clears", () => {
    const { result } = renderPanel({ defaultView: "configure" });
    act(() => result.current.openPanel());
    act(() => result.current.notifySelection(item));
    expect(result.current.view).toBe("inspect");
    act(() => result.current.notifySelection(null));
    expect(result.current.view).toBe("configure");
  });

  it("defaults the home view to Explorer (files) when omitted", () => {
    const { result, rerender } = renderPanel({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    expect(result.current.view).toBe("files");
    act(() => result.current.openPanel());
    act(() => result.current.setView("usage"));
    rerender({ phase: ExecutionPhase.EXECUTION_COMPLETED, hasChanges: false });
    expect(result.current.view).toBe("files");
  });
});
