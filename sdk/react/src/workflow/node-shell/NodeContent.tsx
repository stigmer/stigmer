"use client";

import { memo } from "react";
import type { VisualClass } from "../task-type-visual-registry.js";
import { SVG_SHAPE_CLASSES, getContentInsets } from "./shape-paths.js";

export interface NodeContentProps {
  visualClass: VisualClass;
  taskName: string;
  displayName: string;
  categoryColor: string;
  /** Height of the external caption area below the shape. 0 = internal text. */
  captionHeight?: number;
  isNested?: boolean;
}

/**
 * Renders the text content of a workflow node: task name and kind badge.
 *
 * For rectangular shapes, renders in a standard flex-column layout.
 * For non-rectangular shapes (diamond, octagon, circle, bar), applies
 * content insets and compact rendering to fit within the inscribed
 * safe area.
 */
export const NodeContent = memo(function NodeContent({
  visualClass,
  taskName,
  displayName,
  categoryColor,
  captionHeight = 0,
  isNested,
}: NodeContentProps) {
  const isSvgShape = SVG_SHAPE_CLASSES.has(visualClass);
  const insets = getContentInsets(visualClass);

  if (visualClass === "terminal-pill") {
    return (
      <span className="text-xs font-medium text-[var(--stgm-foreground,#1a1a2e)]">
        {taskName}
      </span>
    );
  }

  if (visualClass === "parallel-bar") {
    return (
      <span className="truncate text-[11px] font-medium text-[var(--stgm-foreground,#1a1a2e)]">
        {taskName}
      </span>
    );
  }

  // SVG shapes: task name only, centered inside the shape.
  // The shape outline + category color already communicates the task type.
  if (isSvgShape) {
    const contentWidth = `calc(100% - ${insets.left + insets.right}px)`;
    return (
      <div
        className="flex items-center justify-center overflow-hidden text-center"
        style={{ maxWidth: contentWidth }}
      >
        <span className="truncate text-xs font-medium leading-tight text-[var(--stgm-foreground,#1a1a2e)]">
          {taskName}
        </span>
      </div>
    );
  }

  // Rectangular shapes: full text inside
  return (
    <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
      <span className="truncate text-sm font-medium text-[var(--stgm-foreground,#1a1a2e)]">
        {taskName}
      </span>
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block rounded px-1 py-px text-[10px] font-medium leading-tight"
          style={{
            color: categoryColor,
            backgroundColor: `color-mix(in srgb, ${categoryColor} 12%, transparent)`,
          }}
        >
          {displayName}
        </span>
        {isNested && (
          <span className="text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
            (nested)
          </span>
        )}
      </div>
    </div>
  );
});

