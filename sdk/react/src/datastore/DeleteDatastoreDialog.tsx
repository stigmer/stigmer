"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Datastore } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import { toast } from "../feedback/toast.js";
import { FIELD_INPUT_CLASSES } from "./FieldValueControl.js";
import { useDeleteDatastore } from "./useDeleteDatastore.js";

/** Props for {@link DeleteDatastoreDialog}. */
export interface DeleteDatastoreDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog requests to close. */
  readonly onOpenChange: (open: boolean) => void;
  /** The loaded datastore (metadata + status feed the counts). */
  readonly datastore: Datastore | null;
  /** Called after a successful delete (navigate away). */
  readonly onDeleted?: () => void;
}

/**
 * The guarded delete flow for the platform's only record-destroying
 * resource action (DD-008 SD-6) — a status-informed acknowledgment
 * replacing the generic one-shot confirm:
 *
 * - Counts are pre-filled from the already-loaded `status` ("holds N
 *   records across M collections").
 * - A **non-empty** datastore requires **typing the datastore slug** to
 *   arm the delete — the strongest-friction confirm. Arming sends the
 *   `force` acknowledgment.
 * - An **empty** datastore keeps the standard destructive confirm.
 * - The server's guards stay authoritative: on refusal (agent
 *   references, count drift) the `FAILED_PRECONDITION` message renders
 *   **verbatim** inside the dialog with fresh server counts — the
 *   console renders the guard, never pre-empts it. The agent-reference
 *   block names the referencing agents; detaching them is the operator's
 *   next step, and the block is deliberately not acknowledgeable-through.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * Zero Console dependencies — safe for platform builder embedding.
 */
export function DeleteDatastoreDialog({
  open,
  onOpenChange,
  datastore,
  onDeleted,
}: DeleteDatastoreDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { deleteDatastore, isDeleting, error, clearError } = useDeleteDatastore();
  const [slugInput, setSlugInput] = useState("");

  const slug = datastore?.metadata?.slug ?? "";
  const resourceId = datastore?.metadata?.id ?? "";

  // BigInt literals (0n) are avoided: consumer apps compile SDK sources
  // with targets below ES2020.
  const { totalRecords, nonEmptyCollections } = useMemo(() => {
    let records = BigInt(0);
    let collections = 0;
    for (const coll of datastore?.status?.collections ?? []) {
      if (coll.recordCount > BigInt(0)) {
        records += coll.recordCount;
        collections += 1;
      }
    }
    return { totalRecords: records, nonEmptyCollections: collections };
  }, [datastore]);

  const isEmpty = totalRecords === BigInt(0);
  const armed = isEmpty || slugInput === slug;

  useEffect(() => {
    if (open) {
      setSlugInput("");
      clearError();
    }
  }, [open, clearError]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const handleDialogCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  const handleDelete = useCallback(async () => {
    if (!resourceId || !armed) return;
    try {
      // A non-empty delete carries force — the acknowledgment the
      // slug-typing arms. Empty datastores need no acknowledgment.
      await deleteDatastore({ resourceId, force: !isEmpty });
      toast.success(`Datastore "${slug}" deleted`);
      onOpenChange(false);
      onDeleted?.();
    } catch {
      // The guard's message renders inline via `error` — with fresh
      // counts on drift; the server stays authoritative.
    }
  }, [resourceId, armed, isEmpty, deleteDatastore, slug, onOpenChange, onDeleted]);

  if (!open || !datastore) return null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleDialogCancel}
      aria-label={`Delete datastore ${slug}`}
      className={cn(
        "fixed inset-0 z-50 m-auto w-full max-w-md rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-lg",
        "backdrop:bg-black/50",
        "open:animate-in open:fade-in-0 open:zoom-in-95",
      )}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-base font-semibold text-foreground">
            Delete datastore “{slug}”?
          </h3>
          {isEmpty ? (
            <p className="text-sm text-muted-foreground">
              This datastore holds no records. Its declared collections will be
              removed. This cannot be undone.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              “{slug}” holds{" "}
              <strong className="font-semibold text-foreground">
                {String(totalRecords)} record{totalRecords === BigInt(1) ? "" : "s"}
              </strong>{" "}
              across{" "}
              <strong className="font-semibold text-foreground">
                {nonEmptyCollections} collection{nonEmptyCollections === 1 ? "" : "s"}
              </strong>
              . Deleting the datastore destroys them all. This cannot be undone.
            </p>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive bg-card px-3 py-2 text-sm text-destructive"
          >
            {getUserMessage(error)}
          </div>
        )}

        {!isEmpty && (
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Type <span className="font-mono text-foreground">{slug}</span> to confirm
            <input
              type="text"
              className={FIELD_INPUT_CLASSES}
              value={slugInput}
              onChange={(e) => setSlugInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label={`Type ${slug} to confirm deletion`}
            />
          </label>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={cn(
              "rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-foreground",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!armed || isDeleting}
            className={cn(
              "rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground",
              "hover:bg-destructive-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {isDeleting ? "Deleting…" : "Delete datastore"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
