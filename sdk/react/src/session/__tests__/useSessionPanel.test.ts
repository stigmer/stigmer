import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { useSessionPanel, type UseSessionPanelOptions } from "../useSessionPanel";
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
