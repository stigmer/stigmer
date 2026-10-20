"use client";

/**
 * Upload Files to keep and reuse: a button that opens the system file
 * chooser and takes files dropped on it, uploading each as a File of the
 * organization that belongs to no conversation (the Library's set).
 *
 * Trade-offs:
 * - Four uploads run at a time, the CLI's pace, so a folder's worth of
 *   files neither queues behind one large file nor floods the server.
 * - No count cap: the twenty-file limit is a message's, and the Library is
 *   not a message.
 * - Each file shows its own state (uploading, failed with the server's
 *   reason); a finished file leaves the list and is reported through
 *   `onUploaded`, so the host refreshes its list or picks the new File.
 * - The browser `File` is handed to `stigmer.file.uploadFile` as it is: a
 *   file above the inline threshold streams to an upload URL from its
 *   backing store, never read whole into memory.
 */

import { useCallback, useRef, useState, type DragEvent } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { cn } from "@stigmer/design-tokens";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { TruncatedText } from "../internal/truncated-text.js";

/** How many uploads run at once. */
export const LIBRARY_UPLOAD_CONCURRENCY = 4;

/** One file the button is uploading, or failed to. */
export interface FileUploadStatus {
  readonly id: string;
  readonly filename: string;
  readonly phase: "queued" | "uploading" | "failed";
  readonly error: string | null;
}

/** Props for {@link FileUploadButton}. */
export interface FileUploadButtonProps {
  /** The organization the Files are uploaded to, by id or slug. */
  readonly org: string;
  /** Called once per File the server stored, in the order they finish. */
  readonly onUploaded?: (file: StigmerFile) => void;
  /** The button's label. @default "Upload" */
  readonly label?: string;
  /** Classes for the button. */
  readonly className?: string;
}

/**
 * A button and drop target that uploads the chosen files as Files of the
 * organization, four at a time, with a status entry per file still
 * uploading or failed.
 */
export function FileUploadButton({ org, onUploaded, label = "Upload", className }: FileUploadButtonProps) {
  const stigmer = useStigmer();
  const inputRef = useRef<HTMLInputElement>(null);
  const [statuses, setStatuses] = useState<readonly FileUploadStatus[]>([]);
  const [dragging, setDragging] = useState(false);
  const nextId = useRef(0);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const update = useCallback((id: string, patch: Partial<FileUploadStatus> | null) => {
    setStatuses((prev) =>
      patch === null ? prev.filter((s) => s.id !== id) : prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  }, []);

  const uploadAll = useCallback(
    async (files: readonly File[]) => {
      const queue = files.map((file) => ({ id: `upload-${++nextId.current}`, file }));
      setStatuses((prev) => [
        ...prev,
        ...queue.map(({ id, file }) => ({ id, filename: file.name, phase: "queued" as const, error: null })),
      ]);
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const { id, file } = next;
          update(id, { phase: "uploading" });
          try {
            const uploaded = await stigmer.file.uploadFile({
              org,
              filename: file.name,
              mimeType: file.type || undefined,
              content: file,
            });
            update(id, null);
            onUploadedRef.current?.(uploaded);
          } catch (err) {
            update(id, { phase: "failed", error: toError(err).message });
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(LIBRARY_UPLOAD_CONCURRENCY, queue.length) }, () => worker()),
      );
    },
    [stigmer, org, update],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragging(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) void uploadAll(files);
    },
    [uploadAll],
  );

  const busy = statuses.some((s) => s.phase !== "failed");

  return (
    <div className="stg:relative stg:inline-flex">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        aria-busy={busy}
        className={cn(
          "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:bg-primary stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:text-primary-foreground stg:transition-colors stg:hover:bg-primary-hover",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          dragging && "stg:ring-2 stg:ring-ring stg:ring-offset-2",
          className,
        )}
      >
        <UploadIcon />
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        aria-label="Choose files to upload"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) void uploadAll(files);
        }}
      />
      {statuses.length > 0 && (
        <ul
          role="status"
          aria-label="Uploads"
          className="stg:absolute stg:right-0 stg:top-full stg:z-20 stg:mt-2 stg:flex stg:w-72 stg:list-none stg:flex-col stg:gap-1 stg:rounded-md stg:border stg:border-border stg:bg-background stg:p-2 stg:shadow-md"
        >
          {statuses.map((status) => (
            <li key={status.id} className="stg:flex stg:min-w-0 stg:items-center stg:gap-2 stg:text-xs">
              <span className="stg:min-w-0 stg:flex-1 stg:truncate stg:text-foreground">{status.filename}</span>
              {status.phase === "failed" ? (
                <>
                  <TruncatedText text={status.error ?? ""} className="stg:max-w-36 stg:text-destructive" />
                  <button
                    type="button"
                    onClick={() => update(status.id, null)}
                    aria-label={`Dismiss ${status.filename}`}
                    className="stg:shrink-0 stg:text-muted-foreground stg:hover:text-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
                  >
                    {"×"}
                  </button>
                </>
              ) : (
                <span className="stg:shrink-0 stg:text-muted-foreground">
                  {status.phase === "queued" ? "Waiting…" : "Uploading…"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 10.5V2.5M4.5 6L8 2.5 11.5 6M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}
