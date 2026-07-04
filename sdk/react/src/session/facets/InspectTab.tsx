"use client";

import type { SelectedThreadItem } from "../../internal/store/selection-store.js";

export interface InspectTabProps {
  readonly selectedItem: SelectedThreadItem | null;
}

/**
 * Selection-driven inspector facet (Phase 2).
 *
 * In Phase 1 this renders an empty hint state. Phase 2 will populate
 * it with tool-call detail, sub-agent mini-thread, and artifact
 * preview based on the selected thread item.
 */
export function InspectTab({ selectedItem }: InspectTabProps) {
  if (!selectedItem) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
        <SelectItemIcon />
        <p className="mt-2 text-xs text-muted-foreground">
          Click a tool call or sub-agent in the thread to inspect it
        </p>
      </div>
    );
  }

  return (
    <div className="px-1 py-2 text-xs text-muted-foreground">
      <p>
        Inspecting: <span className="font-medium text-foreground">{selectedItem.kind}</span>
      </p>
      <p className="mt-1 text-[11px]">
        Detailed view coming in Phase 2.
      </p>
    </div>
  );
}

function SelectItemIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="text-muted-foreground"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="16" height="16" rx="3" />
      <path d="M7 10h6M10 7v6" />
    </svg>
  );
}
