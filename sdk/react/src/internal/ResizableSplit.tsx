"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@stigmer/theme";

/** Which pane carries the drag-controlled pixel width; its sibling flexes. */
export type ResizablePane = "primary" | "secondary";

/**
 * Which pane (if any) collapses when the split's own box is narrower than
 * 48rem, leaving its sibling full-width. Use this to hide the pixel-sized
 * pane in tight quarters — always pair it with
 * {@link ResizableSplitProps.resizablePane} (hide the fixed pane so the
 * visible sibling is the flexing one and fills the row). `"none"` keeps both
 * panes at every width.
 *
 * The narrowness check is a CSS container query against the split root —
 * never a viewport media query — so an embedded dock inside a wide window
 * collapses exactly like a narrow window does (stigmer/stigmer#301). See
 * {@link ResizableSplitProps.responsiveCollapse} for the threshold rationale.
 */
export type ResizableCollapse = "primary" | "secondary" | "none";

/** Props for {@link ResizableSplit}. */
export interface ResizableSplitProps {
  /** Content rendered in the first (left) region. */
  readonly primary: ReactNode;
  /** Content rendered in the second (right) region. */
  readonly secondary: ReactNode;
  /**
   * Which pane is pixel-sized and drag-resizable; the other flexes to fill.
   * Child render order is fixed (`primary` then `secondary`) regardless of this
   * value, so flipping it re-flows the layout without remounting either child.
   * @default "secondary"
   */
  readonly resizablePane?: ResizablePane;
  /**
   * Default width of the resizable pane in pixels.
   * Overridden by a persisted value when `storageKey` is set.
   * @default 384
   */
  readonly defaultSize?: number;
  /** Minimum width of the resizable pane in pixels. @default 280 */
  readonly minSize?: number;
  /** Maximum width of the resizable pane in pixels. @default 800 */
  readonly maxSize?: number;
  /**
   * `localStorage` key for persisting the pane width across sessions.
   * When omitted, the pane width resets to `defaultSize` on remount.
   * Changing this key (or `resizablePane`) re-initializes the width from the
   * new key without remounting — the mechanism the session layout uses to keep
   * a distinct persisted width per mode.
   */
  readonly storageKey?: string;
  /**
   * Which pane collapses when the split's own box is narrower than 48rem
   * (768px, Tailwind's `--container-3xl`).
   *
   * The threshold is fixed and keys on the split root via a CSS container
   * query. 48rem clears the session layout's content minimums (320px min
   * chat + drag handle + a usable workspace panel) and approximately
   * preserves the console's previous viewport-`lg` trigger point, where the
   * viewer's box is the ~1024px window minus the ~240px sidebar. It is
   * deliberately not a prop: container-query conditions cannot read CSS
   * custom properties, so a runtime threshold would need an inline-`<style>`
   * or ResizeObserver mechanism — heavier than the static utility this is,
   * with no consumer needing it.
   *
   * @default "none"
   */
  readonly responsiveCollapse?: ResizableCollapse;
  /**
   * Which pane (if any) is collapsed at every width, hiding the drag handle and
   * letting the sibling fill the row. Unlike conditional rendering at the call
   * site, collapsing through this prop keeps both children mounted at stable
   * tree positions — the session panel uses it so opening/closing the panel
   * never remounts the conversation. The persisted width survives a collapse
   * and applies again on expand.
   * @default "none"
   */
  readonly collapsedPane?: ResizableCollapse;
  /**
   * Accessible label for the drag separator. @default "Resize panel"
   */
  readonly ariaLabel?: string;
  /**
   * Called whenever the resizable pane width changes (during drag
   * and on initial mount from persisted state). Consumers use this
   * to thread the width into layout-dependent calculations like
   * `WorkflowExecutionGraph.panelOffsetPx`.
   */
  readonly onResize?: (widthPx: number) => void;
  /** Additional CSS class names for the root flex container. */
  readonly className?: string;
}

const KEYBOARD_STEP_PX = 20;

/**
 * Read the initial pane width for a given storage key, falling back to
 * `defaultSize` when there is no valid persisted value. Pure of React state so
 * it can seed `useState` and re-seed on a key/pane change.
 */
function readInitialWidth(
  storageKey: string | undefined,
  defaultSize: number,
  minSize: number,
  maxSize: number,
): number {
  if (storageKey) {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = Number(stored);
        if (Number.isFinite(parsed) && parsed >= minSize && parsed <= maxSize) {
          return parsed;
        }
      }
    } catch {
      /* localStorage may be unavailable */
    }
  }
  return defaultSize;
}

/**
 * Horizontal split layout with one drag-resizable pixel-sized pane and one
 * flexible pane.
 *
 * By default the right region (`secondary`) is pixel-sized and the left
 * (`primary`) flexes. Set `resizablePane="primary"` to flip which side carries
 * the width — the session layout uses this to invert between a chat-dominant
 * layout (inspector on the right, fixed) and a workspace-dominant layout (chat
 * on the left, fixed). Render order never changes, so flipping re-flows the row
 * without remounting either child (preserving streaming/scroll state).
 *
 * Design:
 * - Pointer-based drag with `setPointerCapture` for reliable tracking
 * - `requestAnimationFrame` coalescing during drag (DD-009 pattern)
 * - Keyboard accessible: arrow keys nudge by {@link KEYBOARD_STEP_PX}, oriented
 *   so the pane always grows toward its own side
 * - Optional `localStorage` persistence via `storageKey`, re-initialized when
 *   the key or resizable side changes (no remount required)
 * - Optional responsive collapse of the pixel pane when the split's own box
 *   is narrow (container query, not viewport — see `responsiveCollapse`)
 * - Styled with `--stgm-*` tokens; no hardcoded colors
 *
 * @example
 * ```tsx
 * // Chat-dominant: inspector fixed on the right (default)
 * <ResizableSplit
 *   primary={<Conversation />}
 *   secondary={<Inspector />}
 *   storageKey="stgm-session-inspector-width"
 *   responsiveCollapse="secondary"
 * />
 *
 * // Workspace-dominant: chat fixed on the left
 * <ResizableSplit
 *   resizablePane="primary"
 *   primary={<Conversation />}
 *   secondary={<WorkspaceSurface />}
 *   storageKey="stgm-session-chat-width"
 *   responsiveCollapse="primary"
 * />
 * ```
 */
export function ResizableSplit({
  primary,
  secondary,
  resizablePane = "secondary",
  defaultSize = 384,
  minSize = 280,
  maxSize = 800,
  storageKey,
  responsiveCollapse = "none",
  collapsedPane = "none",
  ariaLabel = "Resize panel",
  onResize,
  className,
}: ResizableSplitProps) {
  const isPrimaryResizable = resizablePane === "primary";
  const isCollapsed = collapsedPane !== "none";

  const [panelWidth, setPanelWidth] = useState(() =>
    readInitialWidth(storageKey, defaultSize, minSize, maxSize),
  );

  // Re-initialize the width when the storage key or resizable side changes —
  // the session layout swaps both together on a mode flip and expects the width
  // to come from the new key, not carry over. Adjust-state-during-render
  // (matching `useSessionPanel`) so it lands before paint without a remount.
  const [prevStorageKey, setPrevStorageKey] = useState(storageKey);
  const [prevResizablePane, setPrevResizablePane] = useState(resizablePane);
  if (storageKey !== prevStorageKey || resizablePane !== prevResizablePane) {
    setPrevStorageKey(storageKey);
    setPrevResizablePane(resizablePane);
    setPanelWidth(readInitialWidth(storageKey, defaultSize, minSize, maxSize));
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const isDraggingRef = useRef(false);

  // Notify consumer of the current width whenever it changes (incl. on re-init).
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  useEffect(() => {
    onResizeRef.current?.(panelWidth);
  }, [panelWidth]);

  const clampWidth = useCallback(
    (raw: number) => Math.round(Math.max(minSize, Math.min(maxSize, raw))),
    [minSize, maxSize],
  );

  const persist = useCallback(
    (width: number) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, String(width));
      } catch {
        /* quota or security error */
      }
    },
    [storageKey],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      isDraggingRef.current = true;
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current || !containerRef.current) return;

      const clientX = e.clientX;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        // The resizable pane's width is the distance from its own edge to the
        // pointer: left edge for a primary pane, right edge for a secondary one.
        const raw = isPrimaryResizable
          ? clientX - rect.left
          : rect.right - clientX;
        setPanelWidth(clampWidth(raw));
      });
    },
    [clampWidth, isPrimaryResizable],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      cancelAnimationFrame(rafRef.current);
      persist(panelWidth);
    },
    [persist, panelWidth],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Arrow keys grow the pane toward its own side: a primary (left) pane
      // grows on ArrowRight, a secondary (right) pane grows on ArrowLeft.
      let delta = 0;
      if (e.key === "ArrowLeft") delta = isPrimaryResizable ? -KEYBOARD_STEP_PX : KEYBOARD_STEP_PX;
      else if (e.key === "ArrowRight") delta = isPrimaryResizable ? KEYBOARD_STEP_PX : -KEYBOARD_STEP_PX;
      if (delta === 0) return;

      e.preventDefault();
      setPanelWidth((prev) => {
        const next = clampWidth(prev + delta);
        persist(next);
        return next;
      });
    },
    [clampWidth, persist, isPrimaryResizable],
  );

  // Cleanup rAF on unmount
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const fixedPaneClass = "stg:shrink-0 stg:overflow-hidden";
  const flexPaneClass = "stg:min-w-0 stg:flex-1";

  // A collapsed pane hides entirely and its sibling flexes to fill the row,
  // overriding the fixed/flex split. Width state is untouched, so expanding
  // restores the previous size.
  const primaryPaneClass =
    collapsedPane === "primary"
      ? "hidden"
      : collapsedPane === "secondary" || !isPrimaryResizable
        ? flexPaneClass
        : fixedPaneClass;
  const secondaryPaneClass =
    collapsedPane === "secondary"
      ? "hidden"
      : collapsedPane === "primary" || isPrimaryResizable
        ? flexPaneClass
        : fixedPaneClass;

  return (
    <div
      ref={containerRef}
      className={cn(
        "stg:flex stg:min-h-0 stg:flex-1",
        // The responsive collapse queries the split's OWN width, so the root
        // must be a CSS container (stigmer/stigmer#301). Applied ONLY while a
        // collapse is requested: `container-type: inline-size` imposes layout
        // containment, which re-parents `position: fixed` descendants and
        // creates a stacking context — the workflow inspector's in-tree
        // viewport-covering backdrop (InspectorHeader) lives inside a split
        // pane and must not be captured. The one `responsiveCollapse`
        // consumer (the session layout) has no in-tree fixed descendants:
        // its dialogs are native <dialog> (top layer) and its floating UI
        // portals out.
        responsiveCollapse !== "none" && "stg:@container/resizable-split",
        className,
      )}
    >
      {/* Primary region (first child, order-stable across flips/collapses) */}
      <div
        className={cn(
          primaryPaneClass,
          responsiveCollapse === "primary" &&
            "stg:@max-3xl/resizable-split:hidden",
        )}
        style={
          isPrimaryResizable && !isCollapsed ? { width: panelWidth } : undefined
        }
      >
        {primary}
      </div>

      {/* Drag handle — CSS-hidden (not unmounted) while collapsed so all three
          children keep stable tree positions across a collapse toggle. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={panelWidth}
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        aria-label={ariaLabel}
        aria-hidden={isCollapsed || undefined}
        tabIndex={isCollapsed ? -1 : 0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
        className={cn(
          "stg:group stg:relative stg:z-10 stg:w-1 stg:shrink-0 stg:cursor-col-resize stg:touch-none stg:select-none",
          "stg:bg-[var(--stgm-border,#e5e5e5)]",
          "stg:hover:bg-[var(--stgm-primary,#6366f1)]",
          "stg:focus-visible:bg-[var(--stgm-primary,#6366f1)] stg:focus-visible:outline-none",
          "stg:active:bg-[var(--stgm-primary,#6366f1)]",
          "stg:transition-colors stg:duration-100",
          responsiveCollapse !== "none" && "stg:@max-3xl/resizable-split:hidden",
          isCollapsed && "stg:hidden",
        )}
      >
        {/* Wider invisible hit target (12px) for easier grabbing */}
        <div className="stg:absolute stg:inset-y-0 stg:-left-1.5 stg:-right-1.5" />
      </div>

      {/* Secondary region (second child, order-stable across flips/collapses) */}
      <div
        className={cn(
          secondaryPaneClass,
          responsiveCollapse === "secondary" &&
            "stg:@max-3xl/resizable-split:hidden",
        )}
        style={
          !isPrimaryResizable && !isCollapsed ? { width: panelWidth } : undefined
        }
      >
        {secondary}
      </div>
    </div>
  );
}
