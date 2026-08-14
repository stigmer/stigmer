"use client";

import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { ArtifactFileContent } from "./ArtifactFileContent.js";
import type { SkillPackageDetection } from "../library/detect-skill-package.js";

/** Props for {@link ArtifactContentBody}. */
export interface ArtifactContentBodyProps {
  /** The artifact whose body is rendered. */
  readonly artifact: ExecutionArtifact;
  /** Decoded text content, or `null` (directory / binary / loading / error). */
  readonly content: string | null;
  /** Server-detected content type (rendering-strategy fallback). */
  readonly contentType: string | null;
  /** `true` while the content request is in-flight. */
  readonly isLoading: boolean;
  /** Content-fetch error, or `null`. */
  readonly error: Error | null;
  /** Whether the fetched content was truncated by the server's size cap. */
  readonly isTruncated: boolean;
  /** Skill-package detection for directory artifacts. */
  readonly skillDetection: SkillPackageDetection;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * The shared, chrome-agnostic body of an artifact view: the file-content
 * states (loading / error / binary / text via {@link ArtifactContentRenderer})
 * for FILE artifacts, or the file listing + skill banner for DIRECTORY
 * artifacts.
 *
 * Extracted so the preview modal and the editor-area `ArtifactDocument` render
 * artifact bodies identically — only the surrounding chrome (modal header +
 * action bar vs. document toolbar) differs. Pair with
 * {@link useArtifactInspection}, which supplies every prop here.
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function ArtifactContentBody({
  artifact,
  content,
  contentType,
  isLoading,
  error,
  isTruncated,
  skillDetection,
  className,
}: ArtifactContentBodyProps) {
  const isDirectory = artifact.kind === ExecutionArtifactKind.DIRECTORY;

  return (
    <div className={className}>
      {isDirectory ? (
        <DirectoryContentView artifact={artifact} skillDetection={skillDetection} />
      ) : (
        // File states delegate to the shared, model-agnostic component so the
        // workflow's Artifact-resource document renders content identically.
        <ArtifactFileContent
          fileName={artifact.name}
          content={content}
          contentType={contentType}
          isLoading={isLoading}
          error={error}
          isTruncated={isTruncated}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Directory content (skill banner + file listing)
// ---------------------------------------------------------------------------

function DirectoryContentView({
  artifact,
  skillDetection,
}: {
  readonly artifact: ExecutionArtifact;
  readonly skillDetection: SkillPackageDetection;
}) {
  const entries = artifact.entries;

  return (
    <div className="stg:p-4">
      {skillDetection.detected && (
        <div className="stg:mb-4 stg:rounded-md stg:bg-primary-subtle stg:p-3">
          <p className="stg:text-sm stg:font-medium stg:text-foreground">
            {skillDetection.skillName}
          </p>
          {skillDetection.skillDescription && (
            <p className="stg:mt-1 stg:text-xs stg:text-muted-foreground">
              {skillDetection.skillDescription}
            </p>
          )}
        </div>
      )}

      {entries.length > 0 ? (
        <div>
          <h3 className="stg:mb-2 stg:text-xs stg:font-medium stg:text-muted-foreground">
            Files ({entries.length})
          </h3>
          <ul className={`${UNSTYLED_LIST} stg:space-y-0.5`} role="list">
            {entries.map((entry) => (
              <li
                key={entry}
                className="stg:flex stg:items-center stg:gap-2 stg:rounded-sm stg:px-2 stg:py-1 stg:font-mono stg:text-xs stg:text-foreground"
              >
                <EntryIcon name={entry} />
                <span className="stg:min-w-0 stg:truncate">{entry}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="stg:text-sm stg:text-muted-foreground">
          File listing not available.
        </p>
      )}
    </div>
  );
}

function EntryIcon({ name }: { readonly name: string }) {
  if (name.endsWith("/")) return <FolderSmallIcon />;
  return <FileSmallIcon />;
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function FileSmallIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stg:shrink-0 stg:text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M8 1H4C3.45 1 3 1.45 3 2V12C3 12.55 3.45 13 4 13H10C10.55 13 11 12.55 11 12V4L8 1Z" />
      <path d="M8 1V4H11" />
    </svg>
  );
}

function FolderSmallIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stg:shrink-0 stg:text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M13 11C13 11.55 12.55 12 12 12H2C1.45 12 1 11.55 1 11V3C1 2.45 1.45 2 2 2H5L7 4H12C12.55 4 13 4.45 13 5V11Z" />
    </svg>
  );
}