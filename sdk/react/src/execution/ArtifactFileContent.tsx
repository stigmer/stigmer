"use client";

// The shared file-content state machine for artifact bodies (loading / error /
// unavailable / text). Domain: execution (data-model-agnostic).

import { ArtifactContentRenderer } from "./ArtifactContentRenderer.js";

/** Props for {@link ArtifactFileContent}. */
export interface ArtifactFileContentProps {
  /** File name driving the render-mode dispatch (markdown / yaml / json / text). */
  readonly fileName: string;
  /** Decoded text content, or `null` (binary / loading / error). */
  readonly content: string | null;
  /** Server-detected content type (rendering-strategy fallback). */
  readonly contentType: string | null;
  /** `true` while the content request is in-flight. */
  readonly isLoading: boolean;
  /** Content-fetch error, or `null`. */
  readonly error: Error | null;
  /** Whether the fetched content was truncated by the server's size cap. */
  readonly isTruncated: boolean;
}

const SKELETON_LINE_WIDTHS = [85, 72, 90, 65, 78, 88, 70, 82] as const;

/**
 * The file-content states of an artifact body: loading skeleton, error,
 * "not available for preview" (binary / unfetched), or the rendered text via
 * {@link ArtifactContentRenderer}.
 *
 * Extracted from `ArtifactContentBody` so surfaces on BOTH artifact data
 * models render file content identically — the session's `ExecutionArtifact`
 * bodies (modal + document) and the workflow's `Artifact`-resource document.
 * Deliberately takes plain fields, not an artifact type: the two models share
 * no proto, only this presentation.
 */
export function ArtifactFileContent({
  fileName,
  content,
  contentType,
  isLoading,
  error,
  isTruncated,
}: ArtifactFileContentProps) {
  if (isLoading) {
    return (
      <div className="stg:space-y-2 stg:p-4" aria-busy="true" aria-label="Loading content">
        {SKELETON_LINE_WIDTHS.map((width, i) => (
          <div
            key={i}
            className="stg:h-4 stg:animate-pulse stg:rounded stg:bg-muted"
            style={{ width: `${width}%` }}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="stg:flex stg:flex-col stg:items-center stg:justify-center stg:gap-2 stg:p-8 stg:text-center">
        <ErrorAlertIcon />
        <p className="stg:text-sm stg:text-destructive">{error.message}</p>
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="stg:p-8 stg:text-center stg:text-sm stg:text-muted-foreground">
        Content not available for preview.
      </div>
    );
  }

  return (
    <ArtifactContentRenderer
      content={content}
      fileName={fileName}
      contentType={contentType}
      isTruncated={isTruncated}
    />
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function ErrorAlertIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stg:text-destructive"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 5.5V8.5" />
      <circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
