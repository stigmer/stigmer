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
    harness: "stigmer",
    onHarnessChange: vi.fn(),
    showInteractionModePicker: false,
    interactionMode: "agent",
    onInteractionModeChange: vi.fn(),
    showModelSelector: false,
    modelId: undefined,
    onModelChange: vi.fn(),
    showWorkspace: true,
    workspaceCount: 0,
    workspaceContent: <div data-testid="workspace-popover-content">editor</div>,
    showAttach: false,
    fileCount: 0,
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

describe("ComposerToolbar workspace direct action", () => {
  it("renders popover trigger when onWorkspaceDirectAction is undefined", () => {
    render(<ComposerToolbar {...baseProps()} />);

    const btn = screen.getByLabelText("Workspace");
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe("BUTTON");
  });

  it("calls onWorkspaceDirectAction on click instead of opening popover", () => {
    const directAction = vi.fn();

    render(
      <ComposerToolbar
        {...baseProps({ onWorkspaceDirectAction: directAction })}
      />,
    );

    const btn = screen.getByLabelText("Workspace");
    fireEvent.click(btn);

    expect(directAction).toHaveBeenCalledOnce();
  });

  it("renders workspace badge count on direct-action button", () => {
    const directAction = vi.fn();

    render(
      <ComposerToolbar
        {...baseProps({ onWorkspaceDirectAction: directAction, workspaceCount: 2 })}
      />,
    );

    expect(screen.getByText("2")).toBeTruthy();
  });

  it("disables direct-action button when disabled prop is true", () => {
    const directAction = vi.fn();

    render(
      <ComposerToolbar
        {...baseProps({ onWorkspaceDirectAction: directAction, disabled: true })}
      />,
    );

    const btn = screen.getByLabelText("Workspace");
    expect(btn.hasAttribute("disabled")).toBe(true);

    fireEvent.click(btn);
    expect(directAction).not.toHaveBeenCalled();
  });
});

describe("ComposerToolbar while a turn works", () => {
  it("is a Stop control while nothing can be sent", () => {
    const onStop = vi.fn();
    render(<ComposerToolbar {...baseProps({ canSend: false, onStop })} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
  });

  it("sends a typed message, which waits for the working turn, instead of stopping", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<ComposerToolbar {...baseProps({ canSend: true, onSend, onStop })} />);
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onStop).not.toHaveBeenCalled();
  });
});
