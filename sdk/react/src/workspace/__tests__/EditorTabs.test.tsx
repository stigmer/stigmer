import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EditorTabs } from "../EditorTabs";
import { editorKey, type OpenEditor } from "../../internal/store/index";

const editors: OpenEditor[] = [
  { entryId: "e1", path: "src/a.ts", preview: false },
  { entryId: "e1", path: "src/b.ts", preview: true },
];

function renderTabs(
  overrides: Partial<React.ComponentProps<typeof EditorTabs>> = {},
) {
  const onActivate = vi.fn();
  const onPin = vi.fn();
  const onClose = vi.fn();
  render(
    <EditorTabs
      editors={editors}
      activeKey={editorKey("e1", "src/a.ts")}
      onActivate={onActivate}
      onPin={onPin}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onActivate, onPin, onClose };
}

afterEach(() => cleanup());

describe("EditorTabs", () => {
  it("renders a tab per editor with basenames", () => {
    renderTabs();
    expect(screen.getByRole("tab", { name: /a\.ts/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /b\.ts/ })).toBeTruthy();
  });

  it("marks the active tab aria-selected", () => {
    renderTabs();
    expect(
      screen.getByRole("tab", { name: /a\.ts/ }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("tab", { name: /b\.ts/ }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("renders the preview tab label in italics", () => {
    renderTabs();
    // b.ts is the preview tab; its label span carries the italic class.
    const label = screen.getByText("b.ts");
    expect(label.className).toContain("italic");
    const pinnedLabel = screen.getByText("a.ts");
    expect(pinnedLabel.className).not.toContain("italic");
  });

  it("activates a tab on click", () => {
    const { onActivate } = renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: /b\.ts/ }));
    expect(onActivate).toHaveBeenCalledWith("e1", "src/b.ts");
  });

  it("pins a tab on double click", () => {
    const { onPin } = renderTabs();
    fireEvent.doubleClick(screen.getByRole("tab", { name: /b\.ts/ }));
    expect(onPin).toHaveBeenCalledWith("e1", "src/b.ts");
  });

  it("closes a tab via its close button", () => {
    const { onClose } = renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Close a.ts" }));
    expect(onClose).toHaveBeenCalledWith("e1", "src/a.ts");
  });

  it("closes a tab on middle click", () => {
    const { onClose } = renderTabs();
    fireEvent(
      screen.getByRole("tab", { name: /a\.ts/ }),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(onClose).toHaveBeenCalledWith("e1", "src/a.ts");
  });

  it("moves activation with arrow keys", () => {
    const { onActivate } = renderTabs();
    fireEvent.keyDown(screen.getByRole("tab", { name: /a\.ts/ }), {
      key: "ArrowRight",
    });
    expect(onActivate).toHaveBeenCalledWith("e1", "src/b.ts");
  });

  it("closes the focused tab on Delete", () => {
    const { onClose } = renderTabs();
    fireEvent.keyDown(screen.getByRole("tab", { name: /a\.ts/ }), {
      key: "Delete",
    });
    expect(onClose).toHaveBeenCalledWith("e1", "src/a.ts");
  });
});
