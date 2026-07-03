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
  validateAttachmentSize,
} from "./attachment-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Lifecycle phase of a single attachment managed by {@link useAttachments}.
 *
 * - `uploading` — bytes are being sent to the server
 * - `ready` — upload succeeded, `storageKey` is available
 * - `error` — upload failed, `error` describes the failure
 */
export type AttachmentPhase = "uploading" | "ready" | "error";

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
  /** The original `File` object selected by the user. */
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

/** Return value of {@link useAttachments}. */
export interface UseAttachmentsReturn {
  /** Current attachment entries (uploading, ready, or errored). */
  readonly entries: readonly AttachmentEntry[];
  /** True when at least one entry is in the `"uploading"` phase. */
  readonly isUploading: boolean;
  /** Number of entries that are ready for submission. */
  readonly readyCount: number;
  /** True when there are entries and all are ready (none uploading or errored). */
  readonly allReady: boolean;
  /** True when there is at least one entry (in any phase). */
  readonly hasEntries: boolean;
  /**
   * Add one or more files. Each file is validated and uploaded
   * immediately. Invalid files (e.g., too large) are rejected via
   * `onValidationError` and not added.
   */
  readonly addFiles: (files: FileList | File[]) => void;
  /** Remove an entry by its stable ID. Aborts in-flight uploads. */
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

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const validEntries: AttachmentEntry[] = [];

      for (const file of fileArray) {
        const sizeError = validateAttachmentSize(file);
        if (sizeError) {
          options?.onValidationError?.(sizeError);
          continue;
        }

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
        setEntries((prev) => [...prev, ...validEntries]);
      }
    },
    [options, uploadFile],
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

  const isUploading = entries.some((e) => e.phase === "uploading");
  const readyCount = entries.filter((e) => e.phase === "ready").length;
  const hasEntries = entries.length > 0;
  const allReady = hasEntries && readyCount === entries.length;

  return {
    entries,
    isUploading,
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
