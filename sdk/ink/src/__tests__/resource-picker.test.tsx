import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { type PickerItem, ResourcePicker } from "../components/ResourcePicker.js";

// Key escape sequences understood by ink's input parser.
const KEY = {
  up: "\u001B[A",
  down: "\u001B[B",
  enter: "\r",
  escape: "\u001B",
} as const;

const ITEMS: PickerItem[] = [
  { id: "agt_1", title: "acme/alpha", subtitle: "first agent" },
  { id: "agt_2", title: "acme/beta", subtitle: "second agent" },
  { id: "agt_3", title: "acme/gamma", subtitle: "third agent", meta: "2 hours ago" },
];

// Ink processes stdin asynchronously; yield a macrotask so the frame settles.
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function noop(): void {}

describe("ResourcePicker", () => {
  it("renders the prompt, all items, and the result count", () => {
    const { lastFrame } = render(
      <ResourcePicker
        prompt="Select an agent"
        items={ITEMS}
        query=""
        onQueryChange={noop}
        onSelect={noop}
        onCancel={noop}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Select an agent");
    expect(out).toContain("acme/alpha");
    expect(out).toContain("acme/gamma");
    expect(out).toContain("first agent");
    expect(out).toContain("2 hours ago");
    expect(out).toContain("3 results");
  });

  it("marks the first item active by default", () => {
    const { lastFrame } = render(
      <ResourcePicker items={ITEMS} query="" onQueryChange={noop} onSelect={noop} onCancel={noop} />,
    );
    expect(lastFrame() ?? "").toContain("❯ acme/alpha");
  });

  it("selects the active item on Enter", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ResourcePicker items={ITEMS} query="" onQueryChange={noop} onSelect={onSelect} onCancel={noop} />,
    );
    stdin.write(KEY.enter);
    await tick();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(ITEMS[0]);
  });

  it("moves the cursor down and selects the new active item", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ResourcePicker items={ITEMS} query="" onQueryChange={noop} onSelect={onSelect} onCancel={noop} />,
    );
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onSelect).toHaveBeenCalledWith(ITEMS[2]);
  });

  it("clamps cursor movement at the list boundaries", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ResourcePicker items={ITEMS} query="" onQueryChange={noop} onSelect={onSelect} onCancel={noop} />,
    );
    // Up at the top stays on the first row.
    stdin.write(KEY.up);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onSelect).toHaveBeenLastCalledWith(ITEMS[0]);
    // Past the bottom stays on the last row.
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onSelect).toHaveBeenLastCalledWith(ITEMS[2]);
  });

  it("cancels on Escape without selecting", async () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const { stdin } = render(
      <ResourcePicker items={ITEMS} query="" onQueryChange={noop} onSelect={onSelect} onCancel={onCancel} />,
    );
    stdin.write(KEY.escape);
    await tick();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("forwards typed characters to onQueryChange", async () => {
    const onQueryChange = vi.fn();
    const { stdin } = render(
      <ResourcePicker items={ITEMS} query="" onQueryChange={onQueryChange} onSelect={noop} onCancel={noop} />,
    );
    stdin.write("a");
    await tick();
    expect(onQueryChange).toHaveBeenCalledWith("a");
  });

  it("does not select when Enter is pressed on an empty list", async () => {
    const onSelect = vi.fn();
    const { stdin, lastFrame } = render(
      <ResourcePicker items={[]} query="zzz" onQueryChange={noop} onSelect={onSelect} onCancel={noop} />,
    );
    expect(lastFrame() ?? "").toContain("no results");
    stdin.write(KEY.enter);
    await tick();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows a loading state while searching", () => {
    const { lastFrame } = render(
      <ResourcePicker items={[]} query="x" onQueryChange={noop} onSelect={noop} onCancel={noop} isLoading />,
    );
    expect(lastFrame() ?? "").toContain("searching...");
  });

  it("shows an error state in place of the list", () => {
    const { lastFrame } = render(
      <ResourcePicker
        items={[]}
        query="x"
        onQueryChange={noop}
        onSelect={noop}
        onCancel={noop}
        error={new Error("backend unreachable")}
      />,
    );
    expect(lastFrame() ?? "").toContain("Error: backend unreachable");
  });

  it("scrolls the visible window to keep the active row in view", async () => {
    const many: PickerItem[] = Array.from({ length: 14 }, (_, i) => ({
      id: `id_${i}`,
      title: `item-${i}`,
    }));
    const { stdin, lastFrame } = render(
      <ResourcePicker items={many} query="" onQueryChange={noop} onSelect={noop} onCancel={noop} />,
    );
    // Initially the top of the list is visible, the tail is not.
    expect(lastFrame() ?? "").toContain("item-0");
    expect(lastFrame() ?? "").not.toContain("item-13");
    // Drive the cursor to the bottom; the window should scroll to reveal it.
    for (let i = 0; i < 13; i++) {
      stdin.write(KEY.down);
      await tick();
    }
    expect(lastFrame() ?? "").toContain("item-13");
    expect(lastFrame() ?? "").not.toContain("item-0");
  }, 20000);
});
