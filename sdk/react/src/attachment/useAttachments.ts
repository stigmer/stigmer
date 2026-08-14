"use client";

import { useCallback, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { UploadAttachmentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { AttachmentInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import {
  detectContentType,
  formatFileSize,
  uniquifyFilename,
  validateAttachmentSize,
} from "./attachment-utils.js";
import { prepareImageForVision } from "./prepare-image.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Lifecycle phase of a single attachment managed by {@link useAttachments}.
 *
 * - `preparing` — client-side image preparation is running (see
 *   {@link AddFilesOptions.prepareImages}); the entry exists so the UI can
 *   show the file from the instant it was added, but no bytes have been
 *   sent yet. Only entries added with `prepareImages` ever visit this
 *   phase — everything else starts at `uploading`.
 * - `uploading` — bytes are being sent to the server
 * - `ready` — upload succeeded, `storageKey` is available
 * - `error` — upload failed, `error` describes the failure
 */
export type AttachmentPhase = "preparing" | "uploading" | "ready" | "error";

/**
 * State for a single file being managed by the hook.
 *
 * The `id` is a stable string generated at add-time, used as a React
 * key and for removal. The same `File` added twice produces two
 * independent entries with distinct IDs.
 *
 * @example
 * ```tsx
 * const attachments = useAttachments();
 *
 * attachments.entries.map((entry) => (
 *   <span key={entry.id}>
 *     {entry.file.name}
 *     {entry.phase === "uploading" && <Spinner />}
 *     {entry.phase === "error" && <span>{entry.error}</span>}
 *     {entry.phase === "ready" && <CheckIcon />}
 *   </span>
 * ));
 * ```
 */
export interface AttachmentEntry {
  /** Unique client-side identifier for this attachment. */
  readonly id: string;
  /**
   * The `File` object backing this attachment. For entries added with
   * {@link AddFilesOptions.prepareImages} this starts as the user's
   * original file and swaps to the prepared file (possibly smaller, with
   * a matching extension/MIME change) when the `preparing` phase ends.
   */
  readonly file: File;
  /** Current upload lifecycle phase. */
  readonly phase: AttachmentPhase;
  /** MIME type of the file (e.g. `"image/png"`). */
  readonly contentType: string;
  /** Server-assigned storage key. Set when `phase` is `"ready"`. */
  readonly storageKey: string | null;
  /** Human-readable error message. Set when `phase` is `"error"`. */
  readonly error: string | null;
}

/** Options for {@link useAttachments}. */
export interface UseAttachmentsOptions {
  /**
   * Called when a file is rejected during `addFiles` (e.g., exceeds
   * the size limit). Consumers can use this for toast notifications.
   */
  readonly onValidationError?: (message: string) => void;
}

/** Per-call options for {@link UseAttachmentsReturn.addFiles}. */
export interface AddFilesOptions {
  /**
   * Bound image files to provider vision resolution before upload (via
   * {@link prepareImageForVision}) — the paste-to-attach treatment
   * (stigmer/stigmer#284). Each file's entry appears immediately in the
   * `preparing` phase, so a large screenshot shows a chip the instant it
   * is pasted instead of after the 150-350 ms decode/downscale/re-encode
   * (stigmer/stigmer#369). Non-image files pass through preparation
   * untouched.
   *
   * Meant for pasted content only: a picked or dragged file may be the
   * subject of the task ("read the EXIF"), and silently re-encoding it
   * would be a regression — see prepare-image.ts for the doctrine.
   *
   * With this flag, size validation runs against the PREPARED bytes (the
   * bytes that actually upload), so an oversized paste that downscales
   * under the limit is accepted — identical to preparing before calling
   * `addFiles`, which is what this option replaces. A file still
   * oversized after preparation is removed and reported via
   * `onValidationError`.
   */
  readonly prepareImages?: boolean;
}

/** Return value of {@link useAttachments}. */
export interface UseAttachmentsReturn {
  /** Current attachment entries (preparing, uploading, ready, or errored). */
  readonly entries: readonly AttachmentEntry[];
  /**
   * True while any entry has work in flight (`preparing` or
   * `uploading`). This is the submit gate: `toAttachmentInputs()` carries
   * only `ready` entries, so a send while this is true would silently
   * drop the file the user just added.
   */
  readonly isUploading: boolean;
  /** True when at least one entry is in the `"preparing"` phase. */
  readonly isPreparing: boolean;
  /** Number of entries that are ready for submission. */
  readonly readyCount: number;
  /** True when there are entries and all are ready (none preparing, uploading, or errored). */
  readonly allReady: boolean;
  /** True when there is at least one entry (in any phase). */
  readonly hasEntries: boolean;
  /**
   * Add one or more files. Each file is validated and uploaded
   * immediately. Invalid files (e.g., too large) are rejected via
   * `onValidationError` and not added. With
   * {@link AddFilesOptions.prepareImages}, images are bounded to vision
   * resolution first — entries appear at once in the `preparing` phase.
   */
  readonly addFiles: (files: FileList | File[], addOptions?: AddFilesOptions) => void;
  /** Remove an entry by its stable ID. Aborts in-flight preparation and uploads. */
  readonly removeEntry: (id: string) => void;
  /** Retry a failed upload. */
  readonly retryEntry: (id: string) => void;
  /** Clear all entries and abort any in-flight uploads. */
  readonly clear: () => void;
  /**
   * Produces the `AttachmentInput[]` suitable for execution creation.
   * Only includes entries in the `"ready"` phase.
   */
  readonly toAttachmentInputs: () => AttachmentInput[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

let nextId = 0;
function generateId(): string {
  return `attachment-${++nextId}-${Date.now()}`;
}

/**
 * Behavior hook that manages file attachments for agent executions.
 *
 * Handles the full lifecycle: file validation, upload via
 * `stigmer.agentExecution.uploadAttachment()`, progress tracking,
 * error handling, and retry. Produces `AttachmentInput[]` ready
 * for execution creation.
 *
 * Files are uploaded immediately on selection so the `storageKey`
 * is available by the time the user submits their message.
 *
 * Platform builders who want custom attachment UI import this hook
 * directly. The {@link SessionComposer} styled component uses it
 * internally.
 *
 * @example
 * ```tsx
 * function CustomComposer() {
 *   const attachments = useAttachments({
 *     onValidationError: (msg) => toast.error(msg),
 *   });
 *
 *   return (
 *     <div>
 *       <input
 *         type="file"
 *         multiple
 *         onChange={(e) => {
 *           if (e.target.files) attachments.addFiles(e.target.files);
 *         }}
 *       />
 *       {attachments.entries.map((entry) => (
 *         <div key={entry.id}>
 *           {entry.file.name} — {entry.phase}
 *           {entry.phase === "error" && (
 *             <button onClick={() => attachments.retryEntry(entry.id)}>
 *               Retry
 *             </button>
 *           )}
 *           <button onClick={() => attachments.removeEntry(entry.id)}>
 *             Remove
 *           </button>
 *         </div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAttachments(
  options?: UseAttachmentsOptions,
): UseAttachmentsReturn {
  const stigmer = useStigmer();
  const [entries, setEntries] = useState<AttachmentEntry[]>([]);
  const abortControllers = useRef<Map<string, AbortController>>(new Map());

  // Latest-entries mirror so `addFiles` can uniquify filenames against
  // current entries without depending on `entries` (which would give the
  // callback a new identity every upload-phase change). Re-assigned each
  // render to reconcile removals, and synchronously inside `addFiles` so
  // two adds in one tick still see each other's names.
  const entriesRef = useRef<readonly AttachmentEntry[]>(entries);
  entriesRef.current = entries;

  const uploadFile = useCallback(
    async (id: string, file: File, contentType: string) => {
      const controller = new AbortController();
      abortControllers.current.set(id, controller);

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());

        if (controller.signal.aborted) return;

        const response = await stigmer.agentExecution.uploadAttachment(
          create(UploadAttachmentRequestSchema, {
            filename: file.name,
            content: bytes,
            contentType,
          }),
        );

        if (controller.signal.aborted) return;

        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? { ...e, phase: "ready" as const, storageKey: response.storageKey, error: null }
              : e,
          ),
        );
      } catch (err) {
        if (controller.signal.aborted) return;

        const message = toError(err).message;
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? { ...e, phase: "error" as const, error: message }
              : e,
          ),
        );
      } finally {
        abortControllers.current.delete(id);
      }
    },
    [stigmer],
  );

  // The `preparing` half of the lifecycle (AddFilesOptions.prepareImages):
  // runs prepareImageForVision on the raw file, then hands the result to
  // the normal validate → uniquify → upload sequence. The entry already
  // exists (created by addFiles in the `preparing` phase), so this
  // transitions it rather than creating it.
  const prepareEntry = useCallback(
    async (id: string, rawFile: File) => {
      // Registered under the same id the upload path uses, so removeEntry
      // and clear() cancel a preparation exactly like an upload. The
      // signal is only ever read, never passed down — prepareImageForVision
      // never throws and cannot be interrupted; cancellation means
      // discarding its result.
      const controller = new AbortController();
      abortControllers.current.set(id, controller);

      const prepared = await prepareImageForVision(rawFile);
      if (controller.signal.aborted) return;
      // Hand-off point: from here the upload path owns the map slot
      // (uploadFile registers its own controller under this id).
      abortControllers.current.delete(id);

      // Deferred validation — deliberately on the PREPARED bytes, the
      // bytes that actually upload: a 12 MB screenshot that downscales
      // under the limit must pass, exactly as it did when callers
      // prepared before calling addFiles. Rejection removes the chip the
      // user has been watching, so the toast is the explanation.
      const sizeError = validateAttachmentSize(prepared);
      if (sizeError) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        options?.onValidationError?.(sizeError);
        return;
      }

      // Preparation may rename (extension follows the re-encode format),
      // so uniquify now, against every OTHER entry's settled name —
      // same downstream-breakage rule as the un-prepared path.
      const takenNames = new Set(
        entriesRef.current.filter((e) => e.id !== id).map((e) => e.file.name),
      );
      const uniqueName = uniquifyFilename(prepared.name, takenNames);
      const file =
        uniqueName === prepared.name
          ? prepared
          : new File([prepared], uniqueName, {
              type: prepared.type,
              lastModified: prepared.lastModified,
            });
      const contentType = detectContentType(file);

      setEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, file, contentType, phase: "uploading" as const }
            : e,
        ),
      );
      uploadFile(id, file, contentType);
    },
    [options, uploadFile],
  );

  const addFiles = useCallback(
    (files: FileList | File[], addOptions?: AddFilesOptions) => {
      const fileArray = Array.from(files);
      const validEntries: AttachmentEntry[] = [];
      const takenNames = new Set(entriesRef.current.map((e) => e.file.name));

      for (const rawFile of fileArray) {
        if (addOptions?.prepareImages) {
          // The entry must exist THIS tick — the whole point of the
          // preparing phase is feedback during the decode/downscale gap.
          // Size validation and name uniquification move to prepareEntry:
          // both depend on the prepared file (final bytes, final name).
          const id = generateId();
          validEntries.push({
            id,
            file: rawFile,
            phase: "preparing",
            contentType: detectContentType(rawFile),
            storageKey: null,
            error: null,
          });
          void prepareEntry(id, rawFile);
          continue;
        }

        const sizeError = validateAttachmentSize(rawFile);
        if (sizeError) {
          options?.onValidationError?.(sizeError);
          continue;
        }

        // Duplicate names within a turn break the execution downstream
        // (see uniquifyFilename) — rename before the bytes ever upload,
        // so the chip, the upload, and the mounted file all agree.
        const uniqueName = uniquifyFilename(rawFile.name, takenNames);
        takenNames.add(uniqueName);
        const file =
          uniqueName === rawFile.name
            ? rawFile
            : new File([rawFile], uniqueName, {
                type: rawFile.type,
                lastModified: rawFile.lastModified,
              });

        const id = generateId();
        const contentType = detectContentType(file);

        validEntries.push({
          id,
          file,
          phase: "uploading",
          contentType,
          storageKey: null,
          error: null,
        });

        uploadFile(id, file, contentType);
      }

      if (validEntries.length > 0) {
        entriesRef.current = [...entriesRef.current, ...validEntries];
        setEntries((prev) => [...prev, ...validEntries]);
      }
    },
    [options, uploadFile, prepareEntry],
  );

  const removeEntry = useCallback((id: string) => {
    const controller = abortControllers.current.get(id);
    if (controller) {
      controller.abort();
      abortControllers.current.delete(id);
    }
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const retryEntry = useCallback(
    (id: string) => {
      setEntries((prev) => {
        const entry = prev.find((e) => e.id === id);
        if (!entry || entry.phase !== "error") return prev;

        uploadFile(id, entry.file, entry.contentType);

        return prev.map((e) =>
          e.id === id
            ? { ...e, phase: "uploading" as const, error: null }
            : e,
        );
      });
    },
    [uploadFile],
  );

  const clear = useCallback(() => {
    for (const controller of abortControllers.current.values()) {
      controller.abort();
    }
    abortControllers.current.clear();
    setEntries([]);
  }, []);

  const toAttachmentInputs = useCallback((): AttachmentInput[] => {
    return entries
      .filter(
        (e): e is AttachmentEntry & { storageKey: string } =>
          e.phase === "ready" && e.storageKey !== null,
      )
      .map((e) => ({
        filename: e.file.name,
        storageKey: e.storageKey,
        contentType: e.contentType,
      }));
  }, [entries]);

  const isPreparing = entries.some((e) => e.phase === "preparing");
  // `preparing` counts as uploading-in-the-gate sense: both phases mean
  // "this file will be lost if the message sends now" (see the
  // isUploading doc). Hosts that gate submit on isUploading inherit the
  // preparing gate without a code change.
  const isUploading = entries.some(
    (e) => e.phase === "preparing" || e.phase === "uploading",
  );
  const readyCount = entries.filter((e) => e.phase === "ready").length;
  const hasEntries = entries.length > 0;
  const allReady = hasEntries && readyCount === entries.length;

  return {
    entries,
    isUploading,
    isPreparing,
    readyCount,
    allReady,
    hasEntries,
    addFiles,
    removeEntry,
    retryEntry,
    clear,
    toAttachmentInputs,
  };
}
