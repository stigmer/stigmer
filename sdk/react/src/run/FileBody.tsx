"use client";

// The shared, chrome-agnostic body of an output File's view. Domain: run.

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { ArtifactFileContent } from "./ArtifactFileContent.js";

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

/**
 * The shared body of an output File's view: the file-content states
 * (loading / error / binary / text via {@link ArtifactContentRenderer}).
 *
 * Shared so the preview modal and the editor-area `FileDocument` render
 * bodies identically — only the surrounding chrome (modal header + action
 * bar vs. document toolbar) differs. Pair with {@link useFileInspection},
 * which supplies every prop here.
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
  return (
    <div className={className}>
      <ArtifactFileContent
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
