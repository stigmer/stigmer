"use client";

import { memo } from "react";
import type { VisualClass } from "../task-type-visual-registry";
import { SVG_SHAPE_CLASSES, getContentInsets } from "./shape-paths";

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

  // SVG shapes with external caption: icon + badge inside, task name below
  if (isSvgShape && captionHeight > 0) {
    return (
      <SvgShapeWithCaption
        displayName={displayName}
        taskName={taskName}
        categoryColor={categoryColor}
        captionHeight={captionHeight}
        insets={insets}
      />
    );
  }

  // SVG shapes without caption (legacy/fallback): text inside shape
  if (isSvgShape) {
    const contentWidth = `calc(100% - ${insets.left + insets.right}px)`;
    return (
      <div
        className="flex flex-col items-center gap-0.5 overflow-hidden text-center"
        style={{ maxWidth: contentWidth }}
      >
        <span className="truncate text-xs font-medium leading-tight text-[var(--stgm-foreground,#1a1a2e)]">
          {taskName}
        </span>
        <span
          className="inline-block truncate rounded px-1 py-px text-[9px] font-medium leading-tight"
          style={{
            color: categoryColor,
            backgroundColor: `color-mix(in srgb, ${categoryColor} 12%, transparent)`,
          }}
        >
          {displayName}
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

/**
 * Renders SVG shape content with an external caption below the shape area.
 * Inside the shape: only the kind badge (centered).
 * Below the shape: the task name as a readable caption at full node width.
 */
function SvgShapeWithCaption({
  displayName,
  taskName,
  categoryColor,
  captionHeight,
  insets,
}: {
  displayName: string;
  taskName: string;
  categoryColor: string;
  captionHeight: number;
  insets: ReturnType<typeof getContentInsets>;
}) {
  const contentWidth = `calc(100% - ${insets.left + insets.right}px)`;
  return (
    <>
      {/* Inside shape: kind badge only (centered in shape area) */}
      <div
        className="flex items-center justify-center overflow-hidden text-center"
        style={{ maxWidth: contentWidth }}
      >
        <span
          className="inline-block truncate rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight"
          style={{
            color: categoryColor,
            backgroundColor: `color-mix(in srgb, ${categoryColor} 12%, transparent)`,
          }}
        >
          {displayName}
        </span>
      </div>

      {/* External caption below shape: task name at full width */}
      <div
        className="absolute left-0 right-0 flex items-center justify-center overflow-hidden text-center"
        style={{ bottom: 0, height: captionHeight }}
      >
        <span className="truncate px-1 text-xs font-medium leading-tight text-[var(--stgm-foreground,#1a1a2e)]">
          {taskName}
        </span>
      </div>
    </>
  );
}
