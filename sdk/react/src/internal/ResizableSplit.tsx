"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@stigmer/theme";

/** Props for {@link ResizableSplit}. */
export interface ResizableSplitProps {
  /** Content rendered in the flexible (left) region. */
  readonly primary: ReactNode;
  /** Content rendered in the resizable (right) panel. */
  readonly secondary: ReactNode;
  /**
   * Default width of the secondary panel in pixels.
   * Overridden by a persisted value when `storageKey` is set.
   * @default 384
   */
  readonly defaultSize?: number;
  /** Minimum width of the secondary panel in pixels. @default 280 */
  readonly minSize?: number;
  /** Maximum width of the secondary panel in pixels. @default 800 */
  readonly maxSize?: number;
  /**
   * `localStorage` key for persisting the panel width across sessions.
   * When omitted, the panel width resets to `defaultSize` on remount.
   */
  readonly storageKey?: string;
  /**
   * Called whenever the secondary panel width changes (during drag
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
 * Horizontal split layout with a drag-resizable right panel.
 *
 * The left region (`primary`) fills remaining space via `flex: 1`.
 * The right region (`secondary`) has a pixel-based width controlled
 * by a draggable divider.
 *
 * Design:
 * - Pointer-based drag with `setPointerCapture` for reliable tracking
 * - `requestAnimationFrame` coalescing during drag (DD-009 pattern)
 * - Keyboard accessible: Left/Right arrows nudge by {@link KEYBOARD_STEP_PX}
 * - Optional `localStorage` persistence via `storageKey`
 * - Styled with `--stgm-*` tokens; no hardcoded colors
 *
 * @example
 * ```tsx
 * <ResizableSplit
 *   primary={<WorkflowGraph />}
 *   secondary={<InspectorPanel />}
 *   defaultSize={384}
 *   minSize={280}
 *   maxSize={800}
 *   storageKey="wf-exec-inspector-width"
 *   onResize={setPanelWidth}
 * />
 * ```
 */
export function ResizableSplit({
  primary,
  secondary,
  defaultSize = 384,
  minSize = 280,
  maxSize = 800,
  storageKey,
  onResize,
  className,
}: ResizableSplitProps) {
  const [panelWidth, setPanelWidth] = useState(() => {
    if (storageKey) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const parsed = Number(stored);
          if (Number.isFinite(parsed) && parsed >= minSize && parsed <= maxSize) {
            return parsed;
          }
        }
      } catch { /* localStorage may be unavailable */ }
    }
    return defaultSize;
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const isDraggingRef = useRef(false);

  // Notify consumer of initial width on mount
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
      } catch { /* quota or security error */ }
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
        const newWidth = clampWidth(rect.right - clientX);
        setPanelWidth(newWidth);
      });
    },
    [clampWidth],
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
      let delta = 0;
      if (e.key === "ArrowLeft") delta = KEYBOARD_STEP_PX;
      else if (e.key === "ArrowRight") delta = -KEYBOARD_STEP_PX;
      if (delta === 0) return;

      e.preventDefault();
      setPanelWidth((prev) => {
        const next = clampWidth(prev + delta);
        persist(next);
        return next;
      });
    },
    [clampWidth, persist],
  );

  // Cleanup rAF on unmount
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <div ref={containerRef} className={cn("flex min-h-0 flex-1", className)}>
      {/* Primary region (flexible) */}
      <div className="min-w-0 flex-1">{primary}</div>

      {/* Drag handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={panelWidth}
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        aria-label="Resize inspector panel"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
        className={cn(
          "group relative z-10 w-1 shrink-0 cursor-col-resize touch-none select-none",
          "bg-[var(--stgm-border,#e5e5e5)]",
          "hover:bg-[var(--stgm-primary,#6366f1)]",
          "focus-visible:bg-[var(--stgm-primary,#6366f1)] focus-visible:outline-none",
          "active:bg-[var(--stgm-primary,#6366f1)]",
          "transition-colors duration-100",
        )}
      >
        {/* Wider invisible hit target (12px) for easier grabbing */}
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      </div>

      {/* Secondary region (resizable, fixed width) */}
      <div
        className="shrink-0 overflow-hidden"
        style={{ width: panelWidth }}
      >
        {secondary}
      </div>
    </div>
  );
}
