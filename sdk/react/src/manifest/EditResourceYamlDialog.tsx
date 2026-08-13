"use client";

import { lazy, Suspense, useCallback, useEffect } from "react";
import type { Message } from "@bufbuild/protobuf";
import { cn } from "@stigmer/theme";
import { DialogShell } from "../internal/DialogShell.js";
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
  const edit = useEditResourceYaml({ resource });
  const { reset } = edit;

  // Discard stale edits from a previous session when the dialog opens.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

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
    <DialogShell open={open} onOpenChange={onOpenChange} width="3xl" aria-label="Edit YAML">
      <div className="stg:flex stg:flex-col stg:gap-4 stg:p-6">
        {/* Header */}
        <div className="stg:flex stg:flex-col stg:gap-1">
          <h3 className="stg:text-base stg:font-semibold stg:text-foreground">Edit YAML</h3>
          <p className="stg:text-sm stg:text-muted-foreground">
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
              className="stg:h-80"
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
            className="stg:rounded-md stg:border stg:border-destructive stg:bg-card stg:px-3 stg:py-2.5 stg:text-sm stg:text-destructive"
          >
            {edit.validation.message}
          </div>
        )}

        {/* Apply error — the server's refusal rendered verbatim, with an
            acknowledge-and-retry affordance: the operator reads the
            guard, edits or decides, and re-applies without reopening
            the dialog. */}
        {edit.error && (
          <div
            role="alert"
            className="stg:flex stg:items-start stg:gap-3 stg:rounded-md stg:border stg:border-destructive stg:bg-card stg:px-3 stg:py-2.5"
          >
            <p className="stg:flex-1 stg:text-sm stg:text-destructive">
              {getUserMessage(edit.error)}
            </p>
            <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-2">
              <button
                type="button"
                onClick={handleApply}
                disabled={edit.validation.status !== "valid" || edit.isApplying}
                className={cn(
                  "stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2 stg:py-1 stg:text-xs stg:font-medium stg:text-foreground",
                  "stg:hover:bg-accent stg:hover:text-accent-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
                  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                )}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={edit.clearError}
                aria-label="Dismiss error"
                className={cn(
                  "stg:rounded-md stg:px-2 stg:py-1 stg:text-xs stg:font-medium stg:text-muted-foreground",
                  "stg:hover:bg-accent stg:hover:text-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
                )}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Footer: target summary + actions */}
        <div className="stg:flex stg:items-center stg:justify-between stg:gap-3">
          <p className="stg:text-xs stg:text-muted-foreground" aria-live="polite">
            {targetSummary(edit.validation.status, edit.isDirty, edit.target)}
          </p>
          <div className="stg:flex stg:gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={edit.isApplying}
              className={cn(
                "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
                "stg:border stg:border-input stg:bg-background stg:text-foreground",
                "stg:hover:bg-accent stg:hover:text-accent-foreground",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              )}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!canApply}
              className={cn(
                "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
                "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              )}
            >
              {edit.isApplying ? "Applying…" : "Apply changes"}
            </button>
          </div>
        </div>
      </div>
    </DialogShell>
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
    <div className="stg:flex stg:h-80 stg:items-center stg:justify-center stg:rounded-md stg:border stg:border-border stg:bg-muted stg:text-sm stg:text-muted-foreground">
      {label}
    </div>
  );
}
