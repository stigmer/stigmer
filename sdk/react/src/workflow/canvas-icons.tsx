"use client";

/**
 * Shared 14×14 inline SVG icons for the workflow canvas editor.
 *
 * Used by {@link CanvasTaskNode} (hover buttons + NodeToolbar) and
 * {@link CanvasContextMenu} to maintain visual consistency across
 * all node action surfaces.
 *
 * @internal Not exported from the SDK barrel — implementation detail.
 */

export function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
      <path d="M3 4h8M5 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5.5 6.5v3.5M8.5 6.5v3.5M4 4l.5 7.5a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5L10 4" />
    </svg>
  );
}

export function DuplicateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="5" width="7" height="7" rx="1" />
      <path d="M9 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
      <path d="M7 3v8M3 7h8" />
    </svg>
  );
}
