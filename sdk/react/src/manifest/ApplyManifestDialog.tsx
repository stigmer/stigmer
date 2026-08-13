"use client";

import { lazy, Suspense, useCallback, useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import { DialogShell } from "../internal/DialogShell.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
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
   * Called when the dialog closes after at least one document applied,
   * with the applied entries in apply order — on full success, and also
   * when the operator dismisses the dialog after a partial apply (some
   * documents applied, a later one failed). Use it to refresh a list so
   * the newly applied resources appear without a reload. It never fires
   * when nothing applied, and fires once per close. Mirrors
   * {@link EditResourceYamlDialog}'s `onApplied`.
   */
  readonly onApplied?: (applied: readonly ManifestPreviewEntry[]) => void;
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
 *   onApplied={() => refetchList()}
 * />
 * ```
 */
export function ApplyManifestDialog({
  open,
  onOpenChange,
  org,
  onApplied,
}: ApplyManifestDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const manifest = useApplyManifest(org);
  const { reset } = manifest;

  // Start each session clean.
  useEffect(() => {
    if (open) {
      reset();
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open, reset]);

  // Close the dialog and, if any document applied this session, refresh
  // the caller's list. This is the dismiss-after-partial path: some
  // documents applied before a later one failed, and the operator closes
  // the dialog rather than retrying — those applied resources must still
  // appear. The full-success path in `handleApply` fires `onApplied`
  // itself (it holds the fresh applied list), so it never routes here.
  const closeAndMaybeRefresh = useCallback(() => {
    onOpenChange(false);
    const applied = (manifest.entries ?? []).filter(
      (e) => e.status === "applied",
    );
    if (applied.length > 0) onApplied?.(applied);
  }, [onOpenChange, manifest.entries, onApplied]);

  // Escape/cancel routes through the same dismiss-after-partial path as the
  // Close button, via the shell's single close-intent callback.
  const handleShellOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) closeAndMaybeRefresh();
    },
    [closeAndMaybeRefresh],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) manifest.readFile(file);
    },
    [manifest],
  );

  const handleApply = useCallback(async () => {
    const results = await manifest.applyAll();
    const applied = results.filter((e) => e.status === "applied");
    const allApplied = results.length > 0 && applied.length === results.length;
    if (allApplied) {
      toast.success(
        applied.length === 1
          ? "Resource applied"
          : `${applied.length} resources applied`,
      );
      onOpenChange(false);
      onApplied?.(applied);
    }
    // On partial/total failure the dialog stays open — per-entry status
    // shows what applied and what failed. Any entries that DID apply
    // still refresh the caller's list when the dialog is dismissed
    // (closeAndMaybeRefresh), so successful writes are never hidden.
  }, [manifest, onOpenChange, onApplied]);

  const canApply =
    manifest.entries !== null &&
    manifest.entries.length > 0 &&
    !manifest.isValidating &&
    !manifest.isApplying;

  return (
    <DialogShell open={open} onOpenChange={handleShellOpenChange} width="3xl" aria-label="Apply YAML">
      <div className="stg:flex stg:flex-col stg:gap-4 stg:p-6">
        {/* Header */}
        <div className="stg:flex stg:flex-col stg:gap-1">
          <h3 className="stg:text-base stg:font-semibold stg:text-foreground">Apply YAML</h3>
          <p className="stg:text-sm stg:text-muted-foreground">
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
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-3 stg:py-2 stg:text-sm stg:text-foreground",
            "stg:file:mr-3 stg:file:rounded-md stg:file:border-0 stg:file:bg-primary stg:file:px-2.5 stg:file:py-1 stg:file:text-xs stg:file:font-medium stg:file:text-primary-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
          aria-label="Select manifest file"
        />

        {/* Manifest editor */}
        <Suspense fallback={<EditorLoading />}>
          <LazyYamlEditor
            value={manifest.content}
            onChange={manifest.setContent}
            className="stg:h-56"
          />
        </Suspense>

        {manifest.hasRedactedSecrets && <RedactedSecretsNotice />}

        {/* Validation error */}
        {manifest.validationError && (
          <div
            role="alert"
            className="stg:rounded-md stg:border stg:border-destructive stg:bg-card stg:px-3 stg:py-2.5 stg:text-sm stg:text-destructive"
          >
            {manifest.validationError}
          </div>
        )}

        {/* Per-document preview */}
        {manifest.entries && manifest.entries.length > 0 && (
          <ul className={cn(UNSTYLED_LIST, "stg:flex stg:max-h-48 stg:flex-col stg:gap-2 stg:overflow-y-auto")} aria-label="Resources to apply">
            {manifest.entries.map((entry, index) => (
              <PreviewRow key={`${entry.document.handler.yamlKind}/${entry.document.org}/${entry.document.slug}/${index}`} entry={entry} />
            ))}
          </ul>
        )}

        {/* Actions */}
        <div className="stg:flex stg:items-center stg:justify-between stg:gap-3">
          <p className="stg:text-xs stg:text-muted-foreground" aria-live="polite">
            {manifest.isValidating ? "Validating…" : ""}
          </p>
          <div className="stg:flex stg:gap-2">
            <button
              type="button"
              onClick={closeAndMaybeRefresh}
              disabled={manifest.isApplying}
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
              {manifest.isApplying
                ? "Applying…"
                : applyLabel(manifest.entries?.length ?? 0)}
            </button>
          </div>
        </div>
      </div>
    </DialogShell>
  );
}

function applyLabel(count: number): string {
  if (count <= 1) return "Apply";
  return `Apply ${count} resources`;
}

function EditorLoading() {
  return (
    <div className="stg:flex stg:h-56 stg:items-center stg:justify-center stg:rounded-md stg:border stg:border-border stg:bg-muted stg:text-sm stg:text-muted-foreground">
      Loading editor…
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-document preview row
// ---------------------------------------------------------------------------

function PreviewRow({ entry }: { readonly entry: ManifestPreviewEntry }) {
  return (
    <li className="stg:rounded-md stg:border stg:border-border stg:bg-card stg:px-3 stg:py-2">
      <div className="stg:flex stg:items-center stg:gap-2">
        <span className="stg:inline-flex stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:text-xs stg:font-medium stg:text-muted-foreground">
          {entry.document.handler.displayName}
        </span>
        <span className="stg:text-sm stg:font-medium stg:text-foreground">
          {entry.document.name}
        </span>
        <ActionBadge entry={entry} />
        <span className="stg:ml-auto stg:text-xs stg:text-muted-foreground">
          {entry.document.org}
        </span>
      </div>
      {entry.document.warning && (
        <p className="stg:mt-1 stg:text-xs stg:text-muted-foreground">{entry.document.warning}</p>
      )}
      {entry.status === "failed" && entry.errorMessage && (
        <p role="alert" className="stg:mt-1 stg:text-xs stg:text-destructive">
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
        "stg:inline-flex stg:rounded stg:px-1.5 stg:py-0.5 stg:text-xs stg:font-medium",
        entry.status === "failed"
          ? "stg:bg-card stg:text-destructive stg:border stg:border-destructive"
          : "stg:bg-muted stg:text-muted-foreground",
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
