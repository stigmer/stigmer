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
        "stg:fixed stg:inset-0 stg:z-50 stg:m-auto stg:w-full stg:max-w-md stg:rounded-lg stg:border stg:border-border stg:bg-popover stg:p-0 stg:text-popover-foreground stg:shadow-lg",
        "stg:backdrop:bg-black/50",
        "stg:open:animate-in stg:open:fade-in-0 stg:open:zoom-in-95",
      )}
    >
      <div className="stg:flex stg:flex-col stg:gap-4 stg:p-6">
        <div className="stg:flex stg:flex-col stg:gap-1.5">
          <h3 className="stg:text-base stg:font-semibold stg:text-foreground">
            Delete datastore “{slug}”?
          </h3>
          {isEmpty ? (
            <p className="stg:text-sm stg:text-muted-foreground">
              This datastore holds no records. Its declared collections will be
              removed. This cannot be undone.
            </p>
          ) : (
            <p className="stg:text-sm stg:text-muted-foreground">
              “{slug}” holds{" "}
              <strong className="stg:font-semibold stg:text-foreground">
                {String(totalRecords)} record{totalRecords === BigInt(1) ? "" : "s"}
              </strong>{" "}
              across{" "}
              <strong className="stg:font-semibold stg:text-foreground">
                {nonEmptyCollections} collection{nonEmptyCollections === 1 ? "" : "s"}
              </strong>
              . Deleting the datastore destroys them all. This cannot be undone.
            </p>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="stg:rounded-md stg:border stg:border-destructive stg:bg-card stg:px-3 stg:py-2 stg:text-sm stg:text-destructive"
          >
            {getUserMessage(error)}
          </div>
        )}

        {!isEmpty && (
          <label className="stg:flex stg:flex-col stg:gap-1 stg:text-xs stg:font-medium stg:text-muted-foreground">
            Type <span className="stg:font-mono stg:text-foreground">{slug}</span> to confirm
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

        <div className="stg:flex stg:justify-end stg:gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={cn(
              "stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:text-foreground",
              "stg:hover:bg-accent stg:hover:text-accent-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!armed || isDeleting}
            className={cn(
              "stg:rounded-md stg:bg-destructive stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:text-destructive-foreground",
              "stg:hover:bg-destructive-hover",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            {isDeleting ? "Deleting…" : "Delete datastore"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
