import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ComposerToolbar, type ComposerToolbarProps } from "../ComposerToolbar";

afterEach(cleanup);

function baseProps(overrides: Partial<ComposerToolbarProps> = {}): ComposerToolbarProps {
  return {
    disabled: false,
    isSubmitting: false,
    canSend: true,
    onSend: vi.fn(),
    showHarnessSelector: false,
    harness: "native",
    onHarnessChange: vi.fn(),
    showInteractionModePicker: false,
    interactionMode: "agent",
    onInteractionModeChange: vi.fn(),
    showModelSelector: false,
    modelId: undefined,
    onModelChange: vi.fn(),
    showWorkspace: false,
    workspaceCount: 0,
    workspaceContent: null,
    showAttach: false,
    attachmentCount: 0,
    onAttachClick: vi.fn(),
    configureItems: [],
    configOpen: false,
    onConfigOpenChange: vi.fn(),
    configActivePanel: null,
    onConfigActivePanelChange: vi.fn(),
    renderConfigPanel: () => null,
    ...overrides,
  };
}

describe("ComposerToolbar auto-approve toggle (#816)", () => {
  it("renders nothing when the prop is omitted (DD-011 opt-in)", () => {
    render(<ComposerToolbar {...baseProps()} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("Auto-approve")).toBeNull();
  });

  it("renders a labeled switch reflecting the armed state", () => {
    render(
      <ComposerToolbar
        {...baseProps({ autoApprove: { armed: true, onChange: vi.fn() } })}
      />,
    );
    const toggle = screen.getByRole("switch", { name: "Auto-approve" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("flipping calls onChange with the next value", () => {
    const onChange = vi.fn();
    render(
      <ComposerToolbar
        {...baseProps({ autoApprove: { armed: false, onChange } })}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Auto-approve" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("stays interactive while the toolbar is disabled (the walk-away flip)", () => {
    // The whole point of the toggle is arming DURING a streaming turn, when
    // the rest of the composer is locked — the Stop-button exemption.
    const onChange = vi.fn();
    render(
      <ComposerToolbar
        {...baseProps({ disabled: true, autoApprove: { armed: false, onChange } })}
      />,
    );
    const toggle = screen.getByRole("switch", { name: "Auto-approve" });
    expect(toggle.hasAttribute("disabled")).toBe(false);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  });
});
