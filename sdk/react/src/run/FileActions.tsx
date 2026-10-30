"use client";

/**
 * The acts a File view offers beyond reading it: delete the File, and turn
 * a `.zip` File into a skill. Shared by every chrome that shows one File
 * (the editor-area document, the preview modal, the Library's preview), so
 * the confirmation, the permission gates and the server's refusals read
 * identically everywhere.
 *
 * Trade-offs:
 * - Each act asks the server first (`can_delete` on the File,
 *   `can_create_skill` on its organization) and stays hidden until it
 *   answers yes: one check per opened File, never one per listed row.
 * - "Add as skill" is offered by the `.zip` suffix alone; the server reads
 *   the archive and refuses one that is not a skill with its own message,
 *   which is shown as it is.
 * - Delete goes through the same mutation every Library kind's delete does
 *   (`useDeleteResource`): a refusal is toasted with the server's sentence,
 *   which names the routine that still uses the File.
 */

import { useCallback, useState } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { cn } from "@stigmer/design-tokens";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { useDeleteResource } from "../resource-detail/useDeleteResource.js";
import { useApplyResource, type ApplyResourceResult } from "../library/useApplyResource.js";

const ACTION_CLASSES =
  "stg:inline-flex stg:items-center stg:gap-1.5 stg:text-xs stg:font-medium stg:text-muted-foreground stg:transition-colors stg:hover:text-foreground stg:disabled:opacity-50 stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:rounded-sm";

/** Whether a File's name says it holds a zip archive, the shape a skill is pushed in. */
export function isZipFile(file: StigmerFile): boolean {
  return (file.spec?.filename ?? "").toLowerCase().endsWith(".zip");
}

/** Props for {@link FileDeleteAction}. */
export interface FileDeleteActionProps {
  /** The File to delete. */
  readonly file: StigmerFile;
  /** Called once the server has deleted the File. */
  readonly onDeleted: () => void;
}

/**
 * Delete, with an inline confirmation: offered only when the caller holds
 * `can_delete` on the File. A File given to a conversation also leaves the
 * conversation's resources; a File a routine names is refused by the
 * server, and its sentence is toasted.
 */
export function FileDeleteAction({ file, onDeleted }: FileDeleteActionProps) {
  const fileId = file.metadata?.id ?? "";
  const { allowed, isLoading } = useCheckPermission(
    fileId ? { kind: "file", id: fileId } : null,
    "can_delete",
    { fail: "closed" },
  );
  const [confirming, setConfirming] = useState(false);
  const { deleteResource, isDeleting } = useDeleteResource("file", fileId || null, file.spec?.filename);

  const remove = useCallback(async () => {
    try {
      await deleteResource();
      setConfirming(false);
      onDeleted();
    } catch {
      // Toasted by useDeleteResource with the server's sentence.
      setConfirming(false);
    }
  }, [deleteResource, onDeleted]);

  if (!fileId || isLoading || !allowed) return null;

  if (confirming) {
    return (
      <span className="stg:inline-flex stg:items-center stg:gap-2">
        <span className="stg:text-xs stg:text-foreground">Delete this file?</span>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={isDeleting}
          className={cn(ACTION_CLASSES, "stg:text-destructive stg:hover:text-destructive-muted")}
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isDeleting}
          className={ACTION_CLASSES}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button type="button" onClick={() => setConfirming(true)} className={ACTION_CLASSES}>
      <TrashIcon />
      Delete
    </button>
  );
}

/** Props for {@link FileAddAsSkillAction}. */
export interface FileAddAsSkillActionProps {
  /** The File holding the skill's zip archive. */
  readonly file: StigmerFile;
  /**
   * Called with the new skill once the server has pushed it: the host's
   * link to it (a toast, a navigation), as after an Apply.
   */
  readonly onAdded?: (result: ApplyResourceResult) => void;
}

/**
 * "Add as skill": pushes a `.zip` File as a skill of the File's
 * organization, with an optional tag. Offered only for a `.zip` File and
 * only when the caller holds `can_create_skill` there; the server checks
 * the archive, the size cap and the caller's view of the File.
 */
export function FileAddAsSkillAction({ file, onAdded }: FileAddAsSkillActionProps) {
  const org = file.metadata?.org ?? "";
  const zip = isZipFile(file);
  const { allowed, isLoading } = useCheckPermission(
    zip && org ? { kind: "organization", id: org } : null,
    "can_create_skill",
    { fail: "closed" },
  );
  const { pushSkillFromFile, isApplying, error, clearError } = useApplyResource();
  const [asking, setAsking] = useState(false);
  const [tag, setTag] = useState("");
  const [added, setAdded] = useState<ApplyResourceResult | null>(null);

  const add = useCallback(async () => {
    clearError();
    try {
      const result = await pushSkillFromFile({
        org,
        fileId: file.metadata?.id ?? "",
        tag: tag.trim() || undefined,
      });
      setAdded(result);
      setAsking(false);
      onAdded?.(result);
    } catch {
      // The error state is useApplyResource's.
    }
  }, [clearError, pushSkillFromFile, org, file, tag, onAdded]);

  if (!zip || !org || isLoading || !allowed) return null;

  if (added) {
    return (
      <span className="stg:inline-flex stg:items-center stg:gap-1.5 stg:text-xs stg:font-medium stg:text-status-ready">
        Skill added {"·"} {added.name || added.slug}
      </span>
    );
  }

  if (asking) {
    return (
      <form
        className="stg:inline-flex stg:items-center stg:gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input
          type="text"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          placeholder="Tag (optional)"
          aria-label="Skill tag (optional)"
          className="stg:h-6 stg:w-28 stg:rounded stg:border stg:border-border stg:bg-background stg:px-1.5 stg:text-xs stg:text-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
        />
        <button type="submit" disabled={isApplying} className={cn(ACTION_CLASSES, "stg:text-primary")}>
          {isApplying ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => {
            clearError();
            setAsking(false);
          }}
          disabled={isApplying}
          className={ACTION_CLASSES}
        >
          Cancel
        </button>
        {error && (
          <span className="stg:text-xs stg:text-destructive" role="alert">
            {error.message}
          </span>
        )}
      </form>
    );
  }

  return (
    <button type="button" onClick={() => setAsking(true)} className={ACTION_CLASSES}>
      <SkillIcon />
      Add as skill
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="stg:shrink-0" aria-hidden="true">
      <path d="M1.5 3h9M4.5 3V1.75h3V3M2.75 3l.5 7.25h5.5l.5-7.25" />
    </svg>
  );
}

function SkillIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="stg:shrink-0" aria-hidden="true">
      <path d="M6 1l1.3 3.2L10.5 5 7.3 6.3 6 9.5 4.7 6.3 1.5 5l3.2-.8z" />
    </svg>
  );
}
