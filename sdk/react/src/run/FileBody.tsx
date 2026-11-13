"use client";

// The shared, chrome-agnostic body of one File's view. Domain: run.

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { TextContentView } from "./TextContentView.js";
import { useFileDownloadUrl } from "../file/useFile.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { EmptyState } from "../empty-state/EmptyState.js";

/** Props for {@link FileBody}. */
export interface FileBodyProps {
  /** The File whose body is rendered. */
  readonly file: StigmerFile;
  /** Decoded text content, or `null` (binary / loading / error). */
  readonly content: string | null;
  /** The File's media type (rendering-strategy fallback). */
  readonly contentType: string | null;
  /** `true` while the content request is in-flight. */
  readonly isLoading: boolean;
  /** Content-fetch error, or `null`. */
  readonly error: Error | null;
  /** Whether the fetched content was truncated by the server's size cap. */
  readonly isTruncated: boolean;
  /**
   * Reads the content again (`useFileInspection`'s `refetch`). When given,
   * a failed read offers "Try again" where trying again can help.
   */
  readonly onRetry?: () => void;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/** Whether a File is an image the browser draws from its download link. */
export function isImageFile(file: StigmerFile): boolean {
  return (file.spec?.mimeType ?? "").startsWith("image/");
}

/**
 * The shared body of one File's view: an image drawn from its download
 * link, or the file-content states: loading, a failed read through the
 * kit's {@link ErrorMessage} ("Couldn't load the file.", with Try again when
 * `onRetry` is given), nothing to preview through {@link EmptyState}
 * ("Content not available for preview.", a binary or unread File), or the
 * text via {@link TextContentRenderer}.
 *
 * Shared so the preview window and the session panel's `FileDocument`
 * render bodies identically under one header. Pair with
 * {@link useFileInspection}, which supplies every prop here.
 *
 * An image is shown the way a message's image chip is: through a link the
 * server mints for the File, so its bytes never pass through the API. The
 * image branch lives here, not in the renderer below it, because only a
 * File has a link to mint; the renderer stays free of any data model.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */
export function FileBody({
  file,
  content,
  contentType,
  isLoading,
  error,
  isTruncated,
  onRetry,
  className,
}: FileBodyProps) {
  if (isImageFile(file)) {
    return (
      <div className={className}>
        <FileImage file={file} />
      </div>
    );
  }
  if (!isLoading && error) {
    return (
      <div className={className}>
        <div className="stg:p-4">
          <ErrorMessage error={error} title="Couldn't load the file." retry={onRetry} />
        </div>
      </div>
    );
  }
  if (!isLoading && content === null) {
    return (
      <div className={className}>
        <div className="stg:p-4">
          <EmptyState variant="first-use" icon={<NoPreviewIcon />} title="Content not available for preview." description="" />
        </div>
      </div>
    );
  }
  return (
    <div className={className}>
      <TextContentView
        fileName={file.spec?.filename ?? ""}
        content={content}
        contentType={contentType}
        isLoading={isLoading}
        error={error}
        isTruncated={isTruncated}
      />
    </div>
  );
}

function FileImage({ file }: { readonly file: StigmerFile }) {
  const { url, error } = useFileDownloadUrl(file.metadata?.id ?? null);
  const name = file.spec?.filename ?? "";
  if (error) {
    return (
      <div className="stg:p-4">
        <ErrorMessage error={error} title="Couldn't load the file." />
      </div>
    );
  }
  if (!url) {
    return (
      <div
        className="stg:m-4 stg:h-48 stg:animate-pulse stg:rounded stg:bg-muted"
        role="status"
        aria-label="Loading image"
      />
    );
  }
  return (
    <div className="stg:flex stg:justify-center stg:p-4">
      <img src={url} alt={name} className="stg:max-h-[70vh] stg:max-w-full stg:object-contain" />
    </div>
  );
}

/** A file with a slash through it: there is nothing to draw. */
function NoPreviewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 1.5H5C4.17 1.5 3.5 2.17 3.5 3V13C3.5 13.83 4.17 14.5 5 14.5H11C11.83 14.5 12.5 13.83 12.5 13V4.5L9.5 1.5Z" />
      <path d="M9.5 1.5V4.5H12.5" />
      <path d="M2 2L14 14" />
    </svg>
  );
}
