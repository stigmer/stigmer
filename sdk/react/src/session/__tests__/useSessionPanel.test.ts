import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { useSessionPanel, type UseSessionPanelOptions } from "../useSessionPanel";
import { PLAN_DOCUMENT_ENTRY_ID, PLAN_DOCUMENT_PATH } from "../plan-document";
import { FILE_DOCUMENT_ENTRY_ID } from "../../run/file-document";
import { outputKey } from "../useSessionOutputs";

// ---------------------------------------------------------------------------
// The unified-panel controller: collapsed-by-default state, the open-editor
// group, and the rail-view FSM ported from the retired inspector tabs. The
// FSM rules under test: explicit picks are sticky; auto-switching happens only
// in an OPEN panel (arrivals never auto-open); running⇄terminal transitions
// reset stickiness.
// ---------------------------------------------------------------------------

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
      phase: RunPhase.RUN_IN_PROGRESS,
    });
    act(() => result.current.openPanel());
    act(() => result.current.setView("usage"));
    rerender({
      phase: RunPhase.RUN_COMPLETED,
      hasChanges: false,
    });
    expect(result.current.view).toBe("files");
    // Unstuck: the next arrival auto-switch takes effect again.
    rerender({ phase: RunPhase.RUN_COMPLETED, hasChanges: true });
    expect(result.current.view).toBe("changes");
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

  it("does not open for the plan present when the plan key first becomes known", () => {
    // A host whose plans arrive after mount (read from the conversation's
    // Files) holds planKeyReady false until that read lands.
    const { result, rerender } = renderPanel({ planKey: null, planKeyReady: false });
    rerender({ phase: null, hasChanges: false, planKey: "file_old", planKeyReady: true });
    expect(result.current.isOpen).toBe(false);
    expect(planEditors(result)).toEqual([]);
    // A plan arriving after that is new, and opens the tab.
    rerender({ phase: null, hasChanges: false, planKey: "file_new", planKeyReady: true });
    expect(result.current.isOpen).toBe(true);
    expect(planEditors(result)).toHaveLength(1);
  });

  it("leaves the rail view alone (the tab lives in the editor area)", () => {
    const { result, rerender } = renderPanel();
    act(() => result.current.openPanel());
    act(() => result.current.setView("usage"));
    rerender({ phase: null, hasChanges: false, planKey: "e1:hash-a" });
    expect(result.current.view).toBe("usage");
  });
});

describe("useSessionPanel — File document tabs", () => {
  function artifact(outputPath: string, filename: string) {
    return create(FileSchema, {
      metadata: { id: `file_${filename}` },
      spec: { filename },
      status: { runId: "aex_1", outputPath },
    });
  }

  it("openFileDocument opens the panel with a PREVIEW tab keyed by the document key", () => {
    const { result } = renderPanel();
    const a = artifact(".stigmer/notes.md", "notes.md");
    act(() => result.current.openFileDocument(outputKey(a)));

    expect(result.current.isOpen).toBe(true);
    expect(result.current.editorsStore.getSnapshot().editors).toEqual([
      { entryId: FILE_DOCUMENT_ENTRY_ID, path: outputKey(a), preview: true },
    ]);
  });

  it("reuses the single preview slot as different Files are browsed", () => {
    const { result } = renderPanel();
    act(() => result.current.openFileDocument(outputKey(artifact(".stigmer/a.md", "a.md"))));
    act(() => result.current.openFileDocument(outputKey(artifact(".stigmer/b.md", "b.md"))));

    // VS Code preview semantics: single-click browsing reuses one tab.
    expect(result.current.editorsStore.getSnapshot().editors).toEqual([
      { entryId: FILE_DOCUMENT_ENTRY_ID, path: ".stigmer/b.md", preview: true },
    ]);
  });

  it("does not evict a pinned plan tab when a File opens", () => {
    const { result } = renderPanel();
    act(() => result.current.openPlanDocument());
    act(() => result.current.openFileDocument(outputKey(artifact(".stigmer/a.md", "a.md"))));

    expect(result.current.editorsStore.getSnapshot().editors).toEqual([
      { entryId: PLAN_DOCUMENT_ENTRY_ID, path: PLAN_DOCUMENT_PATH, preview: false },
      { entryId: FILE_DOCUMENT_ENTRY_ID, path: ".stigmer/a.md", preview: true },
    ]);
  });

  it("pinFileDocument promotes an open File preview to a persistent tab", () => {
    const { result } = renderPanel();
    const a = artifact(".stigmer/notes.md", "notes.md");
    // The single-click open leaves a preview tab; the double-click pins it.
    act(() => result.current.openFileDocument(outputKey(a)));
    act(() => result.current.pinFileDocument(outputKey(a)));

    expect(result.current.editorsStore.getSnapshot().editors).toEqual([
      { entryId: FILE_DOCUMENT_ENTRY_ID, path: outputKey(a), preview: false },
    ]);
  });

  it("pinFileDocument is a no-op when the File is not open (mirrors the store's generic pin)", () => {
    const { result } = renderPanel();
    act(() => result.current.pinFileDocument(outputKey(artifact(".stigmer/x.md", "x.md"))));
    expect(result.current.editorsStore.getSnapshot().editors).toEqual([]);
  });
});

describe("useSessionPanel — observed open state (uncontrolled + onOpenChange)", () => {
  // The panel opens ITSELF (file/artifact/plan opens, plan auto-open), so —
  // unlike useDetailTabs' user-driven-only tabs — onOpenChange fires in BOTH
  // modes: passing only the callback observes the panel without controlling
  // it (the issue-#300 docking-host case).
  it("reports the chip toggle without taking control", () => {
    const seen: boolean[] = [];
    const { result } = renderPanel({ onOpenChange: (o) => seen.push(o) });
    act(() => result.current.openPanel());
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.closePanel());
    expect(result.current.isOpen).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it("reports internal open intents (openFile), once per actual transition", () => {
    const seen: boolean[] = [];
    const { result } = renderPanel({ onOpenChange: (o) => seen.push(o) });
    act(() => result.current.openFile("e1", "a.ts"));
    // Already open — a second open intent is not a transition.
    act(() => result.current.openFile("e1", "b.ts"));
    act(() => result.current.openPanel());
    expect(seen).toEqual([true]);
  });

  it("reports the plan auto-open — the beat a docking host makes room for", () => {
    const seen: boolean[] = [];
    const onOpenChange = (o: boolean) => seen.push(o);
    const { rerender } = renderPanel({ onOpenChange });
    rerender({ phase: null, hasChanges: false, planKey: "e1:streaming", onOpenChange });
    expect(seen).toEqual([true]);
  });

  it("starts open when defaultOpen is set, without a spurious notification", () => {
    const seen: boolean[] = [];
    const { result } = renderPanel({
      defaultOpen: true,
      onOpenChange: (o) => seen.push(o),
    });
    expect(result.current.isOpen).toBe(true);
    expect(seen).toEqual([]);
  });
});

describe("useSessionPanel — controlled open state", () => {
  it("follows the host's open value and ignores defaultOpen", () => {
    const { result, rerender } = renderPanel({ open: false, defaultOpen: true });
    expect(result.current.isOpen).toBe(false);
    rerender({ phase: null, hasChanges: false, open: true, defaultOpen: true });
    expect(result.current.isOpen).toBe(true);
  });

  it("surfaces intents through onOpenChange without flipping state itself", () => {
    const seen: boolean[] = [];
    const onOpenChange = (o: boolean) => seen.push(o);
    const { result, rerender } = renderPanel({ open: false, onOpenChange });
    act(() => result.current.openPanel());
    expect(seen).toEqual([true]);
    expect(result.current.isOpen).toBe(false);
    // The host grants the request.
    rerender({ phase: null, hasChanges: false, open: true, onOpenChange });
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.closePanel());
    expect(seen).toEqual([true, false]);
    expect(result.current.isOpen).toBe(true);
  });

  it("re-fires a declined request (once per request, not per transition)", () => {
    const seen: boolean[] = [];
    const onOpenChange = (o: boolean) => seen.push(o);
    const { result } = renderPanel({ open: false, onOpenChange });
    act(() => result.current.openFile("e1", "a.ts"));
    // The host declined (open stayed false) — a later intent must re-fire,
    // not be swallowed by a stale "already requested" memory.
    act(() => result.current.openFile("e1", "b.ts"));
    expect(seen).toEqual([true, true]);
  });

  it("plan auto-open is reported, not applied — but the tab is pinned and ready", () => {
    const seen: boolean[] = [];
    const onOpenChange = (o: boolean) => seen.push(o);
    const { result, rerender } = renderPanel({ open: false, onOpenChange });
    rerender({
      phase: null,
      hasChanges: false,
      planKey: "e1:hash-a",
      open: false,
      onOpenChange,
    });
    expect(seen).toEqual([true]);
    expect(result.current.isOpen).toBe(false);
    // View state stays SDK-owned: the plan tab is pinned regardless, so the
    // moment the host opens the panel the plan is what greets the user.
    expect(result.current.editorsStore.getSnapshot().editors).toEqual([
      { entryId: PLAN_DOCUMENT_ENTRY_ID, path: PLAN_DOCUMENT_PATH, preview: false },
    ]);
  });

  it("auto-surfaces Changes against the HOST's open state, not the internal one", () => {
    // The first-write-back trigger reads the effective open value: a
    // controlled-open panel (whose internal state was never touched) must
    // still surface Changes…
    const { result, rerender } = renderPanel({ open: true });
    rerender({ phase: null, hasChanges: true, open: true });
    expect(result.current.view).toBe("changes");
  });

  it("…and a controlled-closed panel must not", () => {
    const { result, rerender } = renderPanel({ open: false });
    rerender({ phase: null, hasChanges: true, open: false });
    expect(result.current.view).toBe("files");
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
      phase: RunPhase.RUN_IN_PROGRESS,
    });
    act(() => result.current.openPanel());
    act(() => result.current.setView("usage"));
    rerender({
      phase: RunPhase.RUN_COMPLETED,
      hasChanges: false,
      defaultView: "configure",
    });
    expect(result.current.view).toBe("configure");
  });

  it("defaults the home view to Explorer (files) when omitted", () => {
    const { result, rerender } = renderPanel({
      phase: RunPhase.RUN_IN_PROGRESS,
    });
    expect(result.current.view).toBe("files");
    act(() => result.current.openPanel());
    act(() => result.current.setView("usage"));
    rerender({ phase: RunPhase.RUN_COMPLETED, hasChanges: false });
    expect(result.current.view).toBe("files");
  });
});
