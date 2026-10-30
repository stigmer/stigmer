/**
 * Proves the composer toolbar's narrow row (../ComposerToolbar.tsx), the one
 * a phone, a docked panel or a popup gets: below 28 rem of measured width,
 * files and the workspace folder come from one "+" menu (Attach files acts
 * at once; Workspace opens its picker, or the host's direct action), the
 * mode moves into Configure as a panel of its own, and the model picker
 * draws as plain words; at a wide width, and wherever nothing is measured,
 * the row is the wide one. The width is given by a stubbed ResizeObserver
 * and box, since this environment lays nothing out; the real layout is
 * proven in composer-narrow.layout.browser.test.tsx.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComposerToolbar, type ComposerToolbarProps } from "../ComposerToolbar";

let width = 340;
const observers: Array<() => void> = [];

beforeEach(() => {
  width = 340;
  observers.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: () => void) {}
      observe() {
        observers.push(this.callback);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ width, height: 48, top: 0, left: 0, right: width, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function props(overrides: Partial<ComposerToolbarProps> = {}): ComposerToolbarProps {
  return {
    disabled: false,
    isSubmitting: false,
    canSend: true,
    onSend: vi.fn(),
    showHarnessSelector: false,
    harness: "stigmer",
    onHarnessChange: vi.fn(),
    showInteractionModePicker: true,
    interactionMode: "agent",
    onInteractionModeChange: vi.fn(),
    showModelSelector: false,
    modelId: undefined,
    onModelChange: vi.fn(),
    showWorkspace: true,
    workspaceCount: 1,
    workspaceContent: <div data-testid="workspace-picker">picker</div>,
    showAttach: true,
    fileCount: 2,
    onAttachClick: vi.fn(),
    configureItems: [{ id: "skills", icon: null, label: "Skills", count: 0 }],
    configOpen: false,
    onConfigOpenChange: vi.fn(),
    configActivePanel: null,
    onConfigActivePanelChange: vi.fn(),
    renderConfigPanel: (id) => <div data-testid={`panel-${id}`} />,
    ...overrides,
  };
}

/** The toolbar with its Configure menu's state kept, as the composer keeps it. */
function Harness(overrides: Partial<ComposerToolbarProps>) {
  return <ComposerToolbar {...props(overrides)} />;
}

describe("ComposerToolbar, narrow", () => {
  it("collects files and the workspace under one + and moves the mode out of the row", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Add files or a folder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Attach files" })).toBeNull();
    expect(screen.queryByLabelText("Workspace")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Agent/ })).toBeNull();
  });

  it("attaches files at once from the + menu, closing it", () => {
    const onAttachClick = vi.fn();
    render(<Harness onAttachClick={onAttachClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Add files or a folder" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Attach files/ }));
    expect(onAttachClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menuitem", { name: /Attach files/ })).toBeNull();
  });

  it("opens the workspace picker from the + menu, or the host's direct action", () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add files or a folder" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Workspace/ }));
    expect(screen.getByTestId("workspace-picker")).toBeTruthy();
    unmount();

    const direct = vi.fn();
    render(<Harness onWorkspaceDirectAction={direct} />);
    fireEvent.click(screen.getByRole("button", { name: "Add files or a folder" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Workspace/ }));
    expect(direct).toHaveBeenCalledOnce();
  });

  it("offers the mode in Configure, and picking one sets it and returns to the list", () => {
    const onInteractionModeChange = vi.fn();
    const onConfigActivePanelChange = vi.fn();
    const { rerender } = render(
      <Harness configOpen onInteractionModeChange={onInteractionModeChange} onConfigActivePanelChange={onConfigActivePanelChange} />,
    );
    const mode = screen.getByRole("menuitem", { name: /Mode/ });
    expect(mode.textContent).toContain("Agent");
    fireEvent.click(mode);
    expect(onConfigActivePanelChange).toHaveBeenCalledWith("interaction-mode");

    rerender(
      <Harness
        configOpen
        configActivePanel="interaction-mode"
        onInteractionModeChange={onInteractionModeChange}
        onConfigActivePanelChange={onConfigActivePanelChange}
      />,
    );
    expect(screen.getByRole("radio", { name: /Agent/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /Plan/ }));
    expect(onInteractionModeChange).toHaveBeenCalledWith("plan");
    expect(onConfigActivePanelChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps the host's own Configure panels", () => {
    render(<Harness configOpen configActivePanel="skills" />);
    expect(screen.getByTestId("panel-skills")).toBeTruthy();
  });

  it("leaves the mode out of Configure where the person does not pick it", () => {
    render(<Harness configOpen showInteractionModePicker={false} />);
    expect(screen.queryByRole("menuitem", { name: /Mode/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Skills/ })).toBeTruthy();
  });

  it("returns to the wide row when the composer grows past 28 rem", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Add files or a folder" })).toBeTruthy();
    width = 720;
    act(() => observers.forEach((measure) => measure()));
    expect(screen.queryByRole("button", { name: "Add files or a folder" })).toBeNull();
    expect(screen.getByRole("button", { name: "Attach files" })).toBeTruthy();
  });

  it("stays wide wherever nothing is laid out", () => {
    width = 0;
    render(<Harness />);
    expect(screen.queryByRole("button", { name: "Add files or a folder" })).toBeNull();
  });
});
