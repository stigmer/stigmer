"use client";

import { lazy, Suspense, useCallback, useEffect, useRef } from "react";
import type { Message } from "@bufbuild/protobuf";
import { cn } from "@stigmer/theme";
import { getUserMessage, type AppliedManifest } from "@stigmer/sdk";
import { toast } from "../feedback/toast.js";
import { RedactedSecretsNotice } from "./RedactedSecretsNotice.js";
import { useEditResourceYaml } from "./useEditResourceYaml.js";

// CodeMirror loads only when an editor dialog actually opens (DD-013).
const LazyYamlEditor = lazy(() =>
  import("./YamlEditor.js").then((m) => ({ default: m.YamlEditor })),
);

/** Props for {@link EditResourceYamlDialog}. */
export interface EditResourceYamlDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should open or close. */
  readonly onOpenChange: (open: boolean) => void;
  /**
   * The resource to edit, as returned by the server. `null` while loading —
   * the dialog shows the editor as soon as the resource arrives.
   */
  readonly resource: Message | null;
  /** Called after a successful apply. Use for refetching or navigation. */
  readonly onApplied?: (result: AppliedManifest) => void;
}

/**
 * Modal dialog for editing a resource as YAML and applying the changes —
 * the kind-agnostic "Edit YAML" experience for detail pages and panels.
 *
 * Workflow:
 * 1. The resource is serialized to canonical YAML (system-managed state
 *    stripped) and seeded into a CodeMirror editor
 * 2. Every edit is validated against the kind's generated proto schema;
 *    errors render inline with the exact schema complaint
 * 3. A live summary states what applying will do ("update X" / "create Y"),
 *    resolved against server state — so a rename reads as a create
 * 4. Apply calls the kind's `apply` RPC (create-or-update by slug)
 *
 * Redacted secret values (`***REDACTED***`) are explained inline: applying
 * them preserves the stored secrets (the server's marker contract).
 *
 * Uses the native `<dialog>` element for built-in focus trapping, Escape
 * key handling, and backdrop — consistent with {@link ConfirmDialog}.
 *
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * const { agent, refetch } = useAgent(org, slug);
 *
 * <EditResourceYamlDialog
 *   open={editOpen}
 *   onOpenChange={setEditOpen}
 *   resource={agent}
 *   onApplied={() => refetch()}
 * />
 * ```
 */
export function EditResourceYamlDialog({
  open,
  onOpenChange,
  resource,
  onApplied,
}: EditResourceYamlDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const edit = useEditResourceYaml({ resource });
  const { reset } = edit;

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

  // Discard stale edits from a previous session when the dialog opens.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const handleCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  const handleApply = useCallback(async () => {
    try {
      const result = await edit.apply();
      if (!result) return;
      toast.success(`${result.displayName} "${result.name}" applied`);
      onOpenChange(false);
      onApplied?.(result);
    } catch {
      // error state is set by the hook and rendered inline
    }
  }, [edit, onOpenChange, onApplied]);

  const canApply =
    edit.validation.status === "valid" && edit.isDirty && !edit.isApplying;

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      className={cn(
        "fixed inset-0 z-50 m-auto w-full max-w-3xl rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-lg",
        "backdrop:bg-black/50",
        "open:animate-in open:fade-in-0 open:zoom-in-95",
      )}
    >
      <div className="flex flex-col gap-4 p-6">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-foreground">Edit YAML</h3>
          <p className="text-sm text-muted-foreground">
            Edit the resource definition and apply. Changes are validated
            against the resource schema as you type.
          </p>
        </div>

        {/* Editor */}
        {resource ? (
          <Suspense fallback={<EditorLoading />}>
            <LazyYamlEditor
              value={edit.yaml}
              onChange={edit.setYaml}
              className="h-80"
            />
          </Suspense>
        ) : (
          <EditorLoading label="Loading resource…" />
        )}

        {edit.hasRedactedSecrets && <RedactedSecretsNotice />}

        {/* Validation error */}
        {edit.validation.status === "invalid" && (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-card px-3 py-2.5 text-sm text-destructive"
          >
            {edit.validation.message}
          </div>
        )}

        {/* Apply error — the server's refusal (e.g. a datastore
            collection-removal rejection) rendered verbatim, with an
            acknowledge-and-retry affordance: the operator reads the
            guard, edits or decides, and re-applies without reopening
            the dialog. */}
        {edit.error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-md border border-destructive bg-card px-3 py-2.5"
          >
            <p className="flex-1 text-sm text-destructive">
              {getUserMessage(edit.error)}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={handleApply}
                disabled={edit.validation.status !== "valid" || edit.isApplying}
                className={cn(
                  "rounded-md border border-input bg-background px-2 py-1 text-xs font-medium text-foreground",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={edit.clearError}
                aria-label="Dismiss error"
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium text-muted-foreground",
                  "hover:bg-accent hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Footer: target summary + actions */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {targetSummary(edit.validation.status, edit.isDirty, edit.target)}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={edit.isApplying}
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
              onClick={handleApply}
              disabled={!canApply}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary-hover",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              {edit.isApplying ? "Applying…" : "Apply changes"}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function targetSummary(
  validationStatus: "empty" | "invalid" | "valid",
  isDirty: boolean,
  target: ReturnType<typeof useEditResourceYaml>["target"],
): string {
  if (validationStatus !== "valid") return "";
  if (!isDirty) return "No changes yet.";
  if (target === null) return "Checking what applying will do…";
  switch (target.action) {
    case "update":
      return `Applying will update ${target.slug}.`;
    case "create":
      return `Applying will create ${target.slug} — the name or slug changed.`;
    case "unknown":
      return `Applying will create or update ${target.slug}.`;
  }
}

function EditorLoading({ label = "Loading editor…" }: { readonly label?: string }) {
  return (
    <div className="flex h-80 items-center justify-center rounded-md border border-border bg-muted text-sm text-muted-foreground">
      {label}
    </div>
  );
}
