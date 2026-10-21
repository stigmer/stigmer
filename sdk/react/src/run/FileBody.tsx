"use client";

// The shared, chrome-agnostic body of one File's view. Domain: run.

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { TextContentView } from "./TextContentView.js";
import { useFileDownloadUrl } from "../file/useFile.js";

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
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/** Whether a File is an image the browser draws from its download link. */
export function isImageFile(file: StigmerFile): boolean {
  return (file.spec?.mimeType ?? "").startsWith("image/");
}

/**
 * The shared body of one File's view: an image drawn from its download
 * link, or the file-content states (loading / error / binary / text via
 * {@link TextContentRenderer}).
 *
 * Shared so the preview modal and the editor-area `FileDocument` render
 * bodies identically — only the surrounding chrome (modal header + action
 * bar vs. document toolbar) differs. Pair with {@link useFileInspection},
 * which supplies every prop here.
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
  className,
}: FileBodyProps) {
  if (isImageFile(file)) {
    return (
      <div className={className}>
        <FileImage file={file} />
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
      <div className="stg:p-8 stg:text-center stg:text-sm stg:text-destructive">{error.message}</div>
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
