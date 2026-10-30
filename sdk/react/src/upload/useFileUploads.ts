"use client";

/**
 * The chat box's files: each file a person adds becomes a Stigmer File the
 * moment it is added, so it is ready by the time the message sends.
 *
 * Where a File goes follows the conversation. Inside one (`sessionId`) the
 * File is uploaded into it and is the conversation's from the start. Before
 * the first message there is no conversation yet, so the File is the
 * person's own; the run that starts the conversation names it in
 * `file_ids`, the server makes the conversation its own copy, and the
 * original is deleted once that run exists ({@link FileHandOff.release}),
 * so nothing outlives the message but the conversation's copy.
 *
 * Trade-offs:
 * - The browser `File` is handed to `stigmer.file.uploadFile` as it is: a
 *   file above the inline threshold is streamed to an upload URL from its
 *   backing store, never read whole into memory.
 * - A chip removed before sending deletes its File, and so does
 *   {@link UseFileUploadsReturn.clear}: a File nobody sent is not left
 *   behind. So does a chat box that goes away with chips unsent (a
 *   conversation switched away from, a launcher closed), since nothing
 *   keeps a draft of them: in a conversation the File would otherwise stay
 *   among its Files as given though nobody sent it. A tab closed outright
 *   runs no cleanup, and its Files stay, visible where the person's own
 *   Files are listed. Deletion is best effort; a failed delete is not the
 *   person's to act on, so it is not surfaced.
 * - Sending is a hand-off, not a clear: {@link UseFileUploadsReturn.handOff}
 *   empties the chips without deleting anything, because the run that
 *   names the Files does not exist yet.
 * - The chat box holds at most {@link MAX_MESSAGE_FILES} files, the most a
 *   message carries: a file past it is refused before it uploads, since
 *   the send (and every retry of it) would be refused.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStigmer } from "@stigmer/react-core";
import { toError } from "@stigmer/react-core/internal";
import type { MessageFileView } from "../run/MessageFiles.js";
import {
  detectContentType,
  uniquifyFilename,
  validateFileSize,
} from "./upload-utils.js";
import { prepareImageForVision } from "./prepare-image.js";

/**
 * The most Files one message carries: the server refuses a run naming more
 * in `file_ids`. {@link useFileUploads} holds no more entries than this.
 */
export const MAX_MESSAGE_FILES = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Lifecycle phase of one file managed by {@link useFileUploads}.
 *
 * - `preparing`: client-side image preparation is running (see
 *   {@link AddFilesOptions.prepareImages}); the entry exists so the UI can
 *   show the file from the instant it was added, but no bytes have been
 *   sent yet. Only entries added with `prepareImages` visit this phase.
 * - `uploading`: the bytes are on their way to the server.
 * - `ready`: the File exists; `fileId` names it.
 * - `error`: the upload failed; `error` says why.
 */
export type FileUploadPhase = "preparing" | "uploading" | "ready" | "error";

/**
 * One file in the chat box.
 *
 * The `id` is a stable client-side string generated when the file is
 * added, used as a React key and for removal. The same `File` added twice
 * produces two entries with distinct ids and two Files.
 *
 * @example
 * ```tsx
 * const uploads = useFileUploads({ org });
 *
 * uploads.entries.map((entry) => (
 *   <span key={entry.id}>
 *     {entry.file.name}
 *     {entry.phase === "uploading" && <Spinner />}
 *     {entry.phase === "error" && <span>{entry.error}</span>}
 *   </span>
 * ));
 * ```
 */
export interface FileUploadEntry {
  /** Client-side identifier of this entry. */
  readonly id: string;
  /**
   * The browser `File` behind the entry. For entries added with
   * {@link AddFilesOptions.prepareImages} this starts as the person's
   * original and becomes the prepared file (possibly smaller, with its
   * extension and type following the re-encode) when `preparing` ends.
   */
  readonly file: File;
  /** Current lifecycle phase. */
  readonly phase: FileUploadPhase;
  /** Media type of the file (`"image/png"`). */
  readonly contentType: string;
  /** The uploaded File's id (`"file_01j…"`). Set when `phase` is `"ready"`. */
  readonly fileId: string | null;
  /**
   * True when the File was uploaded into the conversation; false when it
   * is the person's own, to be deleted once the run that names it exists.
   */
  readonly inConversation: boolean;
  /** What went wrong. Set when `phase` is `"error"`. */
  readonly error: string | null;
}

/** Options for {@link useFileUploads}. */
export interface UseFileUploadsOptions {
  /**
   * Organization the Files belong to, by id or slug; inside a
   * conversation, the conversation's organization. Without it a file
   * cannot be uploaded and its entry ends in the `error` phase.
   */
  readonly org?: string;
  /**
   * The conversation the Files go into. Omit it before the first message:
   * the Files are then the person's own until the run names them.
   */
  readonly sessionId?: string;
  /**
   * Called when a file is refused while it is added (for example, it
   * exceeds the size limit, or the chat box already holds
   * {@link MAX_MESSAGE_FILES} files). Use it for a toast.
   */
  readonly onValidationError?: (message: string) => void;
}

/** Per-call options for {@link UseFileUploadsReturn.addFiles}. */
export interface AddFilesOptions {
  /**
   * Bound image files to provider vision resolution before upload (via
   * {@link prepareImageForVision}), the paste-to-attach treatment
   * (stigmer/stigmer#284). Each file's entry appears immediately in the
   * `preparing` phase, so a large screenshot shows a chip the instant it
   * is pasted instead of after the decode, downscale and re-encode
   * (stigmer/stigmer#369). Non-image files pass through untouched.
   *
   * Meant for pasted content only: a picked or dragged file may be the
   * subject of the task ("read the EXIF"), and silently re-encoding it
   * would change it (prepare-image.ts says why).
   *
   * Size validation runs against the prepared bytes, the ones that
   * upload, so an oversized paste that downscales under the limit is
   * accepted. A file still oversized after preparation is removed and
   * reported through `onValidationError`.
   */
  readonly prepareImages?: boolean;
}

/**
 * The ready Files of a message, taken from the chat box by
 * {@link UseFileUploadsReturn.handOff}.
 */
export interface FileHandOff {
  /** The Files' ids, in the order they were added: the run's `fileIds`. */
  readonly fileIds: string[];
  /** The Files as the optimistic message bubble shows them. */
  readonly files: readonly MessageFileView[];
  /**
   * Delete the person's own Files among them. Call it once the run that
   * names {@link fileIds} exists: the conversation then holds its own
   * copies, and the originals would only linger. Files uploaded into the
   * conversation are kept. Safe to call more than once; the deletes run
   * once.
   */
  readonly release: () => Promise<void>;
}

/** Return value of {@link useFileUploads}. */
export interface UseFileUploadsReturn {
  /** Current entries (preparing, uploading, ready or failed). */
  readonly entries: readonly FileUploadEntry[];
  /**
   * True while any entry has work in flight (`preparing` or `uploading`).
   * This is the send gate: {@link handOff} takes only `ready` entries, so a
   * send while this is true would drop the file the person just added.
   */
  readonly isUploading: boolean;
  /** True when at least one entry is `preparing`. */
  readonly isPreparing: boolean;
  /** Number of entries whose File is ready. */
  readonly readyCount: number;
  /** True when there are entries and every one is ready. */
  readonly allReady: boolean;
  /** True when there is at least one entry, in any phase. */
  readonly hasEntries: boolean;
  /**
   * Add one or more files. Each is validated and uploaded at once; a file
   * refused (too large, or past {@link MAX_MESSAGE_FILES} entries) is
   * reported through `onValidationError` and not added.
   */
  readonly addFiles: (files: FileList | File[], addOptions?: AddFilesOptions) => void;
  /**
   * Remove an entry: in-flight work is cancelled, and its File, once it
   * exists, is deleted.
   */
  readonly removeEntry: (id: string) => void;
  /** Upload a failed entry again. */
  readonly retryEntry: (id: string) => void;
  /** Remove every entry and delete every File the entries uploaded. */
  readonly clear: () => void;
  /** The ready Files' ids, in the order they were added. */
  readonly toFileIds: () => string[];
  /**
   * Take the ready Files for a message and empty the chat box without
   * deleting anything. Entries not ready are dropped (and their uploads
   * cancelled). Call {@link FileHandOff.release} once the run exists.
   */
  readonly handOff: () => FileHandOff;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

let nextId = 0;
function generateId(): string {
  return `file-upload-${++nextId}-${Date.now()}`;
}

/** How a ready entry shows in a message bubble. */
export function toFileChipView(entry: FileUploadEntry): MessageFileView {
  return {
    fileId: entry.fileId ?? undefined,
    filename: entry.file.name,
    kind: entry.contentType.startsWith("image/") ? "image" : "document",
  };
}

/**
 * Behaviour hook for the files given with a message: validation, upload as
 * Stigmer Files, progress, retry and removal, and the hand-off to the run
 * that names them.
 *
 * Platform builders who want their own chat-box UI import this hook; the
 * {@link SessionComposer} styled component uses it internally.
 *
 * @example
 * ```tsx
 * function CustomComposer({ org, sessionId, send }: Props) {
 *   const uploads = useFileUploads({ org, sessionId });
 *
 *   const submit = async (message: string) => {
 *     const files = uploads.handOff();
 *     await send(message, files.fileIds);
 *     await files.release();
 *   };
 *
 *   return (
 *     <input
 *       type="file"
 *       multiple
 *       onChange={(e) => e.target.files && uploads.addFiles(e.target.files)}
 *     />
 *   );
 * }
 * ```
 */
export function useFileUploads(options?: UseFileUploadsOptions): UseFileUploadsReturn {
  const stigmer = useStigmer();
  const org = options?.org;
  const sessionId = options?.sessionId;
  const onValidationError = options?.onValidationError;
  const [entries, setEntries] = useState<FileUploadEntry[]>([]);
  const abortControllers = useRef<Map<string, AbortController>>(new Map());

  // Latest-entries mirror, so the callbacks read current entries without
  // taking `entries` as a dependency (which would give them a new identity
  // on every phase change). Re-assigned each render, and synchronously in
  // addFiles so two adds in one tick see each other's names.
  const entriesRef = useRef<readonly FileUploadEntry[]>(entries);
  entriesRef.current = entries;

  const deleteFile = useCallback(
    (fileId: string) => {
      stigmer.file.delete(fileId).catch(() => undefined);
    },
    [stigmer],
  );

  // Going away deletes what was never sent: the entries still held, the
  // same set clear() deletes (a hand-off empties the ref first, so a sent
  // File is never touched), and an upload still in flight once it lands.
  // React's development double mount runs this cleanup and mounts again at
  // once, even after a mount effect added files (a composer's initial
  // files), so nothing is deleted until the unmount has stood past
  // the current task: a remount clears `disposed` first and keeps them.
  const disposed = useRef(false);
  const deleteFileRef = useRef(deleteFile);
  deleteFileRef.current = deleteFile;
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      setTimeout(() => {
        if (!disposed.current) return;
        for (const entry of entriesRef.current) {
          if (entry.fileId) deleteFileRef.current(entry.fileId);
        }
      }, 0);
    };
  }, []);

  const upload = useCallback(
    async (id: string, file: File, contentType: string) => {
      const controller = new AbortController();
      abortControllers.current.set(id, controller);

      try {
        if (!org) {
          throw new Error("Choose an organization before attaching files.");
        }
        const uploaded = await stigmer.file.uploadFile({
          org,
          sessionId,
          filename: file.name,
          mimeType: contentType || undefined,
          content: file,
        });
        const fileId = uploaded.metadata?.id ?? "";

        if (controller.signal.aborted || disposed.current) {
          // Removed, or the chat box went away, while the bytes were in
          // flight: the File arrived for a chip that no longer exists.
          if (fileId) deleteFile(fileId);
          return;
        }

        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? {
                  ...e,
                  phase: "ready" as const,
                  fileId,
                  inConversation: (uploaded.status?.sessionId ?? "") !== "",
                  error: null,
                }
              : e,
          ),
        );
      } catch (err) {
        if (controller.signal.aborted) return;

        const message = toError(err).message;
        setEntries((prev) =>
          prev.map((e) => (e.id === id ? { ...e, phase: "error" as const, error: message } : e)),
        );
      } finally {
        if (abortControllers.current.get(id) === controller) {
          abortControllers.current.delete(id);
        }
      }
    },
    [stigmer, org, sessionId, deleteFile],
  );

  // The `preparing` half of the lifecycle (AddFilesOptions.prepareImages):
  // prepare the raw file, then validate, uniquify and upload the result.
  // The entry already exists in the `preparing` phase.
  const prepareEntry = useCallback(
    async (id: string, rawFile: File) => {
      // Registered under the entry's id so removeEntry and clear cancel a
      // preparation exactly like an upload. prepareImageForVision cannot
      // be interrupted; cancelling means discarding its result.
      const controller = new AbortController();
      abortControllers.current.set(id, controller);

      const prepared = await prepareImageForVision(rawFile);
      if (controller.signal.aborted) return;
      abortControllers.current.delete(id);

      // Validated on the prepared bytes, the ones that upload.
      const sizeError = validateFileSize(prepared);
      if (sizeError) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        onValidationError?.(sizeError);
        return;
      }

      // Preparation may rename (the extension follows the re-encode), so
      // the name is made unique now, against every other entry's.
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
        prev.map((e) => (e.id === id ? { ...e, file, contentType, phase: "uploading" as const } : e)),
      );
      void upload(id, file, contentType);
    },
    [onValidationError, upload],
  );

  const addFiles = useCallback(
    (files: FileList | File[], addOptions?: AddFilesOptions) => {
      const added: FileUploadEntry[] = [];
      // Work starts once the entries are in state: an upload that fails
      // before its first await must find its entry to mark.
      const starts: (() => void)[] = [];
      const takenNames = new Set(entriesRef.current.map((e) => e.file.name));
      // Every entry, in any phase, may become one of the message's Files.
      let slots = MAX_MESSAGE_FILES - entriesRef.current.length;
      let overCap = 0;

      for (const rawFile of Array.from(files)) {
        if (slots <= 0) {
          overCap++;
          continue;
        }
        if (addOptions?.prepareImages) {
          // The entry exists this tick: the preparing phase is the
          // feedback during the decode and downscale.
          const id = generateId();
          added.push({
            id,
            file: rawFile,
            phase: "preparing",
            contentType: detectContentType(rawFile),
            fileId: null,
            inConversation: false,
            error: null,
          });
          starts.push(() => void prepareEntry(id, rawFile));
          slots--;
          continue;
        }

        const sizeError = validateFileSize(rawFile);
        if (sizeError) {
          onValidationError?.(sizeError);
          continue;
        }

        // Two files of one message under one name would be ambiguous to
        // the agent: rename before the bytes upload, so the chip and the
        // File agree.
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
        added.push({
          id,
          file,
          phase: "uploading",
          contentType,
          fileId: null,
          inConversation: false,
          error: null,
        });
        starts.push(() => void upload(id, file, contentType));
        slots--;
      }

      if (overCap > 0) {
        onValidationError?.(
          `A message carries at most ${MAX_MESSAGE_FILES} files; ${overCap === 1 ? "1 file was" : `${overCap} files were`} not added.`,
        );
      }
      if (added.length > 0) {
        entriesRef.current = [...entriesRef.current, ...added];
        setEntries((prev) => [...prev, ...added]);
      }
      for (const start of starts) start();
    },
    [onValidationError, upload, prepareEntry],
  );

  const cancel = useCallback((id: string) => {
    const controller = abortControllers.current.get(id);
    if (controller) {
      controller.abort();
      abortControllers.current.delete(id);
    }
  }, []);

  const removeEntry = useCallback(
    (id: string) => {
      cancel(id);
      const entry = entriesRef.current.find((e) => e.id === id);
      if (entry?.fileId) deleteFile(entry.fileId);
      entriesRef.current = entriesRef.current.filter((e) => e.id !== id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    },
    [cancel, deleteFile],
  );

  const retryEntry = useCallback(
    (id: string) => {
      const entry = entriesRef.current.find((e) => e.id === id);
      if (!entry || entry.phase !== "error") return;
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, phase: "uploading" as const, error: null } : e)),
      );
      void upload(id, entry.file, entry.contentType);
    },
    [upload],
  );

  const clear = useCallback(() => {
    for (const entry of entriesRef.current) {
      cancel(entry.id);
      if (entry.fileId) deleteFile(entry.fileId);
    }
    entriesRef.current = [];
    setEntries([]);
  }, [cancel, deleteFile]);

  const toFileIds = useCallback(
    (): string[] =>
      entries.flatMap((e) => (e.phase === "ready" && e.fileId ? [e.fileId] : [])),
    [entries],
  );

  const handOff = useCallback((): FileHandOff => {
    const ready = entriesRef.current.filter(
      (e): e is FileUploadEntry & { fileId: string } => e.phase === "ready" && e.fileId !== null,
    );
    for (const entry of entriesRef.current) cancel(entry.id);
    entriesRef.current = [];
    setEntries([]);

    const owned = ready.filter((e) => !e.inConversation).map((e) => e.fileId);
    let released: Promise<void> | null = null;
    return {
      fileIds: ready.map((e) => e.fileId),
      files: ready.map(toFileChipView),
      release: () => {
        released ??= Promise.all(
          owned.map((fileId) => stigmer.file.delete(fileId).catch(() => undefined)),
        ).then(() => undefined);
        return released;
      },
    };
  }, [cancel, stigmer]);

  const isPreparing = entries.some((e) => e.phase === "preparing");
  // `preparing` gates a send exactly like `uploading`: both mean the file
  // would be lost if the message sent now.
  const isUploading = entries.some((e) => e.phase === "preparing" || e.phase === "uploading");
  const readyCount = entries.filter((e) => e.phase === "ready").length;
  const hasEntries = entries.length > 0;
  const allReady = hasEntries && readyCount === entries.length;

  return useMemo(
    () => ({
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
      toFileIds,
      handOff,
    }),
    [entries, isUploading, isPreparing, readyCount, allReady, hasEntries, addFiles, removeEntry, retryEntry, clear, toFileIds, handOff],
  );
}
