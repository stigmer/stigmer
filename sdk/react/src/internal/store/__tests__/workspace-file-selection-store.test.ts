import { describe, it, expect, vi } from "vitest";
import {
  WorkspaceFileSelectionStore,
  type SelectedWorkspaceFile,
} from "../workspace-file-selection-store";

function file(entryId: string, path: string): SelectedWorkspaceFile {
  return { entryId, path };
}

describe("WorkspaceFileSelectionStore", () => {
  it("starts with null selection", () => {
    const store = new WorkspaceFileSelectionStore();
    expect(store.getSelection()).toBeNull();
  });

  it("select sets the selection and notifies listeners", () => {
    const store = new WorkspaceFileSelectionStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.select(file("ws-1", "src/index.ts"));
    expect(store.getSelection()).toEqual(file("ws-1", "src/index.ts"));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("select with an equal file does not notify", () => {
    const store = new WorkspaceFileSelectionStore();
    store.select(file("ws-1", "src/index.ts"));

    const listener = vi.fn();
    store.subscribe(listener);

    store.select(file("ws-1", "src/index.ts"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps a stable snapshot reference between mutations (getSnapshot safety)", () => {
    const store = new WorkspaceFileSelectionStore();
    store.select(file("ws-1", "a.ts"));
    expect(store.getSelection()).toBe(store.getSelection());
  });

  it("select notifies when only the path differs within the same entry", () => {
    const store = new WorkspaceFileSelectionStore();
    store.select(file("ws-1", "a.ts"));

    const listener = vi.fn();
    store.subscribe(listener);

    store.select(file("ws-1", "b.ts"));
    expect(store.getSelection()).toEqual(file("ws-1", "b.ts"));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("deselect clears the selection and notifies", () => {
    const store = new WorkspaceFileSelectionStore();
    store.select(file("ws-1", "a.ts"));

    const listener = vi.fn();
    store.subscribe(listener);

    store.deselect();
    expect(store.getSelection()).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("deselect when already null does not notify", () => {
    const store = new WorkspaceFileSelectionStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.deselect();
    expect(listener).not.toHaveBeenCalled();
  });

  it("toggle selects when nothing is selected", () => {
    const store = new WorkspaceFileSelectionStore();
    store.toggle(file("ws-1", "a.ts"));
    expect(store.getSelection()).toEqual(file("ws-1", "a.ts"));
  });

  it("toggle deselects when the same file is selected", () => {
    const store = new WorkspaceFileSelectionStore();
    store.select(file("ws-1", "a.ts"));
    store.toggle(file("ws-1", "a.ts"));
    expect(store.getSelection()).toBeNull();
  });

  it("toggle switches to a different file", () => {
    const store = new WorkspaceFileSelectionStore();
    store.select(file("ws-1", "a.ts"));
    store.toggle(file("ws-2", "b.ts"));
    expect(store.getSelection()).toEqual(file("ws-2", "b.ts"));
  });

  it("unsubscribe removes the listener", () => {
    const store = new WorkspaceFileSelectionStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);

    unsub();
    store.select(file("ws-1", "a.ts"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple listeners", () => {
    const store = new WorkspaceFileSelectionStore();
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);

    store.select(file("ws-1", "a.ts"));
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });
});
