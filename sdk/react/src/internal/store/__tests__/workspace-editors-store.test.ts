import { describe, it, expect, beforeEach } from "vitest";
import { WorkspaceEditorsStore } from "../workspace-editors-store";

function paths(store: WorkspaceEditorsStore): string[] {
  return store.getSnapshot().editors.map((e) => e.path);
}

let store: WorkspaceEditorsStore;
beforeEach(() => {
  store = new WorkspaceEditorsStore();
});

describe("WorkspaceEditorsStore", () => {
  it("starts empty", () => {
    const snap = store.getSnapshot();
    expect(snap.editors).toEqual([]);
    expect(snap.activeKey).toBeNull();
    expect(snap.activeFile).toBeNull();
  });

  it("openPreview adds a preview tab and makes it active", () => {
    store.openPreview("e1", "a.ts");
    const snap = store.getSnapshot();
    expect(snap.editors).toEqual([{ entryId: "e1", path: "a.ts", preview: true }]);
    expect(snap.activeFile).toEqual({ entryId: "e1", path: "a.ts" });
  });

  it("openPreview reuses the single preview slot for a new file", () => {
    store.openPreview("e1", "a.ts");
    store.openPreview("e1", "b.ts");
    // b.ts replaced a.ts in place — still one tab, now b.ts.
    expect(paths(store)).toEqual(["b.ts"]);
    expect(store.getSnapshot().activeFile).toEqual({ entryId: "e1", path: "b.ts" });
  });

  it("openPreview on an already-open editor just focuses it (no duplicate)", () => {
    store.openPinned("e1", "a.ts");
    store.openPinned("e1", "b.ts");
    store.openPreview("e1", "a.ts");
    expect(paths(store)).toEqual(["a.ts", "b.ts"]);
    expect(store.getSnapshot().activeFile).toEqual({ entryId: "e1", path: "a.ts" });
    // a.ts stays pinned — focusing does not turn it back into a preview.
    expect(store.getSnapshot().editors[0].preview).toBe(false);
  });

  it("a pinned tab survives when a subsequent preview opens", () => {
    store.openPinned("e1", "a.ts");
    store.openPreview("e1", "b.ts");
    store.openPreview("e1", "c.ts");
    // a.ts pinned stays; the preview slot cycled b.ts -> c.ts.
    expect(paths(store)).toEqual(["a.ts", "c.ts"]);
  });

  it("openPinned promotes an existing preview tab to persistent", () => {
    store.openPreview("e1", "a.ts");
    expect(store.getSnapshot().editors[0].preview).toBe(true);
    store.openPinned("e1", "a.ts");
    expect(store.getSnapshot().editors[0].preview).toBe(false);
    expect(paths(store)).toEqual(["a.ts"]);
  });

  it("pin clears the preview flag", () => {
    store.openPreview("e1", "a.ts");
    store.pin("e1", "a.ts");
    expect(store.getSnapshot().editors[0].preview).toBe(false);
  });

  it("activate focuses an open tab and no-ops for an unopened one", () => {
    store.openPinned("e1", "a.ts");
    store.openPinned("e1", "b.ts");
    store.activate("e1", "a.ts");
    expect(store.getSnapshot().activeFile).toEqual({ entryId: "e1", path: "a.ts" });
    store.activate("e1", "missing.ts");
    expect(store.getSnapshot().activeFile).toEqual({ entryId: "e1", path: "a.ts" });
  });

  it("close removes a tab and activates the right neighbor", () => {
    store.openPinned("e1", "a.ts");
    store.openPinned("e1", "b.ts");
    store.openPinned("e1", "c.ts");
    store.activate("e1", "b.ts");
    store.close("e1", "b.ts");
    expect(paths(store)).toEqual(["a.ts", "c.ts"]);
    // The tab that shifted into b's slot (c.ts) becomes active.
    expect(store.getSnapshot().activeFile).toEqual({ entryId: "e1", path: "c.ts" });
  });

  it("close activates the left neighbor when the last tab is closed", () => {
    store.openPinned("e1", "a.ts");
    store.openPinned("e1", "b.ts");
    store.activate("e1", "b.ts");
    store.close("e1", "b.ts");
    expect(store.getSnapshot().activeFile).toEqual({ entryId: "e1", path: "a.ts" });
  });

  it("closing the only tab empties the group", () => {
    store.openPreview("e1", "a.ts");
    store.close("e1", "a.ts");
    expect(store.getSnapshot().editors).toEqual([]);
    expect(store.getSnapshot().activeFile).toBeNull();
  });

  it("closing an inactive tab keeps the active one", () => {
    store.openPinned("e1", "a.ts");
    store.openPinned("e1", "b.ts");
    store.activate("e1", "b.ts");
    store.close("e1", "a.ts");
    expect(store.getSnapshot().activeFile).toEqual({ entryId: "e1", path: "b.ts" });
  });

  it("keys files by entry, so same path in two entries are distinct tabs", () => {
    store.openPinned("e1", "a.ts");
    store.openPinned("e2", "a.ts");
    expect(store.getSnapshot().editors).toHaveLength(2);
    expect(store.getSnapshot().activeFile).toEqual({ entryId: "e2", path: "a.ts" });
  });

  it("returns a stable snapshot ref between mutations", () => {
    store.openPreview("e1", "a.ts");
    const snapA = store.getSnapshot();
    const snapB = store.getSnapshot();
    expect(snapA).toBe(snapB);
    store.openPreview("e1", "b.ts");
    expect(store.getSnapshot()).not.toBe(snapA);
  });

  it("notifies subscribers on mutation", () => {
    let count = 0;
    const unsub = store.subscribe(() => {
      count++;
    });
    store.openPreview("e1", "a.ts");
    expect(count).toBe(1);
    unsub();
    store.openPreview("e1", "b.ts");
    expect(count).toBe(1);
  });

  it("closeAll empties a populated group and is a no-op when empty", () => {
    store.openPinned("e1", "a.ts");
    let count = 0;
    store.subscribe(() => {
      count++;
    });
    store.closeAll();
    expect(store.getSnapshot().editors).toEqual([]);
    expect(count).toBe(1);
    store.closeAll();
    expect(count).toBe(1);
  });
});
