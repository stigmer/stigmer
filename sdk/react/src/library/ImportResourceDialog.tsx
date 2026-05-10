"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import { toast } from "../feedback/toast";
import { useImportResource } from "./useImportResource";
import type { ApplyResourceResult } from "./useApplyResource";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Props for {@link ImportResourceDialog}. */
export interface ImportResourceDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should open or close. */
  readonly onOpenChange: (open: boolean) => void;
  /** Target organization slug to apply the imported resource to. */
  readonly org: string;
  /** Called after a successful import. Use for navigation or list refresh. */
  readonly onSuccess?: (result: ApplyResourceResult) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Modal dialog for importing a Stigmer resource from a YAML or JSON file.
 *
 * Workflow:
 * 1. User selects a `.yaml`, `.yml`, or `.json` file via the file picker
 * 2. The file is validated and a preview card shows the detected resource
 * 3. User confirms the import, which calls `apply()` on the target org
 * 4. On success: toast notification and `onSuccess` callback
 * 5. On error: inline error message with guidance
 *
 * Uses the native `<dialog>` element for built-in focus trapping, Escape
 * key handling, and backdrop — consistent with {@link ConfirmDialog}.
 *
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 *
 * <ImportResourceDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   org={activeOrg}
 *   onSuccess={(result) => {
 *     router.push(`/library/${result.kind === "Agent" ? "agents" : "mcp-servers"}`);
 *   }}
 * />
 * ```
 */
export function ImportResourceDialog({
  open,
  onOpenChange,
  org,
  onSuccess,
}: ImportResourceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { readFile, preview, error, reset, apply, isApplying } = useImportResource();

  // Sync dialog open state with the native <dialog> element.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Reset state when the dialog opens.
  useEffect(() => {
    if (open) {
      reset();
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [open, reset]);

  const handleCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        readFile(file);
      }
    },
    [readFile],
  );

  const handleConfirm = useCallback(async () => {
    try {
      const result = await apply(org);
      toast.success(`${result.kind === "Agent" ? "Agent" : "MCP Server"} "${result.name}" imported successfully`);
      onOpenChange(false);
      onSuccess?.(result);
    } catch {
      // error is set by the hook
    }
  }, [apply, org, onOpenChange, onSuccess]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      className={cn(
        "fixed inset-0 z-50 m-auto w-full max-w-md rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-lg",
        "backdrop:bg-black/50",
        "open:animate-in open:fade-in-0 open:zoom-in-95",
      )}
    >
      <div className="flex flex-col gap-5 p-6">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-foreground">
            Import resource
          </h3>
          <p className="text-sm text-muted-foreground">
            Select a YAML or JSON file containing a Stigmer Agent or MCP Server definition.
          </p>
        </div>

        {/* File picker */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml,.json"
            onChange={handleFileChange}
            className={cn(
              "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground",
              "file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-primary-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            aria-label="Select resource file"
          />
        </div>

        {/* Validation error */}
        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-card px-3 py-2.5 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        {/* Preview card */}
        {preview && !error && (
          <div className="rounded-md border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                {preview.kind === "Agent" ? "Agent" : "MCP Server"}
              </span>
              <span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground uppercase">
                {preview.format}
              </span>
            </div>
            <p className="mt-1.5 text-sm font-medium text-foreground">
              {preview.name}
            </p>
            {preview.slug && preview.slug !== preview.name && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {preview.slug}
              </p>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              Will be applied to <span className="font-medium text-foreground">{org}</span>
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={isApplying}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "border border-input bg-background text-foreground",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!preview || !!error || isApplying}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {isApplying ? "Importing\u2026" : "Import"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
