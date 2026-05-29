import { describe, it, expect, vi } from "vitest";
import { SelectionStore, type SelectedThreadItem } from "../selection-store";

function toolCall(id: string): SelectedThreadItem {
  return { kind: "tool-call", toolCallId: id };
}

function subAgent(id: string): SelectedThreadItem {
  return { kind: "sub-agent", subAgentId: id };
}

describe("SelectionStore", () => {
  it("starts with null selection", () => {
    const store = new SelectionStore();
    expect(store.getSelection()).toBeNull();
  });

  it("select sets the selection and notifies listeners", () => {
    const store = new SelectionStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.select(toolCall("tc-1"));
    expect(store.getSelection()).toEqual(toolCall("tc-1"));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("select with the same item does not notify", () => {
    const store = new SelectionStore();
    store.select(toolCall("tc-1"));

    const listener = vi.fn();
    store.subscribe(listener);

    store.select(toolCall("tc-1"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("deselect clears the selection and notifies", () => {
    const store = new SelectionStore();
    store.select(toolCall("tc-1"));

    const listener = vi.fn();
    store.subscribe(listener);

    store.deselect();
    expect(store.getSelection()).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("deselect when already null does not notify", () => {
    const store = new SelectionStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.deselect();
    expect(listener).not.toHaveBeenCalled();
  });

  it("toggle selects when nothing is selected", () => {
    const store = new SelectionStore();
    store.toggle(toolCall("tc-1"));
    expect(store.getSelection()).toEqual(toolCall("tc-1"));
  });

  it("toggle deselects when the same item is selected", () => {
    const store = new SelectionStore();
    store.select(toolCall("tc-1"));
    store.toggle(toolCall("tc-1"));
    expect(store.getSelection()).toBeNull();
  });

  it("toggle switches to a different item", () => {
    const store = new SelectionStore();
    store.select(toolCall("tc-1"));
    store.toggle(subAgent("sa-1"));
    expect(store.getSelection()).toEqual(subAgent("sa-1"));
  });

  it("isSelected returns true for the selected item", () => {
    const store = new SelectionStore();
    store.select(toolCall("tc-1"));

    expect(store.isSelected("tool-call", "tc-1")).toBe(true);
    expect(store.isSelected("tool-call", "tc-2")).toBe(false);
    expect(store.isSelected("sub-agent", "tc-1")).toBe(false);
  });

  it("isSelected returns false when nothing is selected", () => {
    const store = new SelectionStore();
    expect(store.isSelected("tool-call", "tc-1")).toBe(false);
  });

  it("unsubscribe removes the listener", () => {
    const store = new SelectionStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);

    unsub();
    store.select(toolCall("tc-1"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple listeners", () => {
    const store = new SelectionStore();
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);

    store.select(toolCall("tc-1"));
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });
});
