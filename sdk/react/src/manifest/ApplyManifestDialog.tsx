"use client";

import { lazy, Suspense, useCallback, useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import { toast } from "../feedback/toast.js";
import { RedactedSecretsNotice } from "./RedactedSecretsNotice.js";
import {
  useApplyManifest,
  type ManifestPreviewEntry,
} from "./useApplyManifest.js";

// CodeMirror loads only when the dialog actually opens (DD-013).
const LazyYamlEditor = lazy(() =>
  import("./YamlEditor.js").then((m) => ({ default: m.YamlEditor })),
);

/** Props for {@link ApplyManifestDialog}. */
export interface ApplyManifestDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should open or close. */
  readonly onOpenChange: (open: boolean) => void;
  /** Target organization slug for documents that omit `metadata.org`. */
  readonly org: string;
  /**
   * Called after every document applied successfully, with the per-document
   * results in apply order. Use for navigation or list refresh.
   */
  readonly onSuccess?: (entries: readonly ManifestPreviewEntry[]) => void;
}

/**
 * Modal dialog for applying a Stigmer resource manifest — paste YAML or
 * upload a file, review what will change, and apply. The console
 * counterpart of `stigmer apply -f`, for every supported resource kind.
 *
 * Workflow:
 * 1. Paste manifest YAML (or JSON) into the editor, or pick a file
 * 2. Each document is validated against its kind's generated proto schema
 *    and previewed with a create-or-update badge resolved from server state
 * 3. Apply runs the documents sequentially in dependency order with live
 *    per-document status; a failure stops the run and renders inline
 *
 * Multi-document manifests (`---` separators) are supported. Documents
 * that omit `metadata.org` are applied to the active org; documents naming
 * a different org are honored with a warning (matching `stigmer apply`).
 *
 * Uses the native `<dialog>` element for built-in focus trapping, Escape
 * key handling, and backdrop — consistent with {@link ConfirmDialog}.
 *
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * <ApplyManifestDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   org={activeOrg}
 *   onSuccess={() => refetchList()}
 * />
 * ```
 */
export function ApplyManifestDialog({
  open,
  onOpenChange,
  org,
  onSuccess,
}: ApplyManifestDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const manifest = useApplyManifest(org);
  const { reset } = manifest;

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

  // Start each session clean.
  useEffect(() => {
    if (open) {
      reset();
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open, reset]);

  const handleCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) manifest.readFile(file);
    },
    [manifest],
  );

  const handleApply = useCallback(async () => {
    const allApplied = await manifest.applyAll();
    if (allApplied && manifest.entries) {
      const count = manifest.entries.length;
      toast.success(
        count === 1 ? "Resource applied" : `${count} resources applied`,
      );
      onOpenChange(false);
      onSuccess?.(manifest.entries);
    }
    // On failure the dialog stays open — per-entry status shows what
    // applied and what failed.
  }, [manifest, onOpenChange, onSuccess]);

  const canApply =
    manifest.entries !== null &&
    manifest.entries.length > 0 &&
    !manifest.isValidating &&
    !manifest.isApplying;

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
          <h3 className="text-base font-semibold text-foreground">Apply YAML</h3>
          <p className="text-sm text-muted-foreground">
            Paste a resource manifest or upload a file. Resources are created
            when new and updated when they already exist.
          </p>
        </div>

        {/* File picker */}
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
          aria-label="Select manifest file"
        />

        {/* Manifest editor */}
        <Suspense fallback={<EditorLoading />}>
          <LazyYamlEditor
            value={manifest.content}
            onChange={manifest.setContent}
            className="h-56"
          />
        </Suspense>

        {manifest.hasRedactedSecrets && <RedactedSecretsNotice />}

        {/* Validation error */}
        {manifest.validationError && (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-card px-3 py-2.5 text-sm text-destructive"
          >
            {manifest.validationError}
          </div>
        )}

        {/* Per-document preview */}
        {manifest.entries && manifest.entries.length > 0 && (
          <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto" aria-label="Resources to apply">
            {manifest.entries.map((entry, index) => (
              <PreviewRow key={`${entry.document.handler.yamlKind}/${entry.document.org}/${entry.document.slug}/${index}`} entry={entry} />
            ))}
          </ul>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {manifest.isValidating ? "Validating…" : ""}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={manifest.isApplying}
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
              {manifest.isApplying
                ? "Applying…"
                : applyLabel(manifest.entries?.length ?? 0)}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function applyLabel(count: number): string {
  if (count <= 1) return "Apply";
  return `Apply ${count} resources`;
}

function EditorLoading() {
  return (
    <div className="flex h-56 items-center justify-center rounded-md border border-border bg-muted text-sm text-muted-foreground">
      Loading editor…
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-document preview row
// ---------------------------------------------------------------------------

function PreviewRow({ entry }: { readonly entry: ManifestPreviewEntry }) {
  return (
    <li className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
          {entry.document.handler.displayName}
        </span>
        <span className="text-sm font-medium text-foreground">
          {entry.document.name}
        </span>
        <ActionBadge entry={entry} />
        <span className="ml-auto text-xs text-muted-foreground">
          {entry.document.org}
        </span>
      </div>
      {entry.document.warning && (
        <p className="mt-1 text-xs text-muted-foreground">{entry.document.warning}</p>
      )}
      {entry.status === "failed" && entry.errorMessage && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {entry.errorMessage}
        </p>
      )}
    </li>
  );
}

function ActionBadge({ entry }: { readonly entry: ManifestPreviewEntry }) {
  const label = badgeLabel(entry);
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-xs font-medium",
        entry.status === "failed"
          ? "bg-card text-destructive border border-destructive"
          : "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function badgeLabel(entry: ManifestPreviewEntry): string {
  switch (entry.status) {
    case "applying":
      return "Applying…";
    case "applied":
      return "Applied";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "pending":
      switch (entry.action) {
        case "create":
          return "Will create";
        case "update":
          return "Will update";
        case "unknown":
          return "Create or update";
      }
  }
}
