"use client";

// A change a turn made, opened from the turn's outcome in a viewer with no
// inspector (an embed, a chat link): the file's before and after as a diff,
// in the same dialog shell the File preview uses.

import type { DisplayFileChange } from "@stigmer/client";
import { DialogShell } from "../internal/DialogShell.js";
import { FileChangeDiff } from "../run/FileChangesView.js";

/** Props for {@link TurnChangeDialog}. */
export interface TurnChangeDialogProps {
  /** The change to show; the dialog is closed while it is null. */
  readonly change: DisplayFileChange | null;
  readonly onClose: () => void;
}

/** A turn's captured change in a dialog (module header). */
export function TurnChangeDialog({ change, onClose }: TurnChangeDialogProps) {
  return (
    <DialogShell
      open={change !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      width="3xl"
      aria-label={change === null ? "Change" : `Change to ${change.path}`}
      className="stg:bg-background stg:text-foreground stg:outline-none"
    >
      {change !== null && (
        <div className="stg:flex stg:max-h-[80vh] stg:flex-col stg:gap-3 stg:p-4">
          <div className="stg:flex stg:items-center stg:gap-3">
            <h2 className="stg:min-w-0 stg:flex-1 stg:truncate stg:font-mono stg:text-sm stg:font-semibold">{change.path}</h2>
            <button
              type="button"
              onClick={onClose}
              className="stg:rounded-md stg:border stg:border-border stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:hover:bg-muted"
            >
              Close
            </button>
          </div>
          <FileChangeDiff change={change} showFileName={false} className="stg:min-h-0 stg:flex-1 stg:overflow-auto" />
        </div>
      )}
    </DialogShell>
  );
}
