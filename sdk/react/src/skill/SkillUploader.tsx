"use client";

import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { cn } from "@stigmer/theme";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { MARKDOWN_COMPONENTS, REMARK_PLUGINS, stripFrontmatter } from "../internal/markdown-components.js";
import { useSkillUpload } from "./useSkillUpload.js";
import { usePushSkill } from "./usePushSkill.js";
import { useSkillDuplicateCheck } from "./useSkillDuplicateCheck.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Props for {@link SkillUploader}. */
export interface SkillUploaderProps {
  /** Organization that will own the uploaded skill. */
  readonly org: string;
  /** Optional version tag for the push (e.g. "stable"). */
  readonly tag?: string;
  /** Called after a successful push with the persisted skill resource. */
  readonly onComplete?: (skill: Skill) => void;
  /** Called when the user cancels the upload flow. */
  readonly onCancel?: () => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Skill package upload component with validation and preview.
 *
 * Two-phase flow:
 * 1. **Drop zone** — User drags/drops or clicks to select a .zip file
 * 2. **Preview + confirm** — Validated package summary, file listing,
 *    rendered SKILL.md preview, and push button
 *
 * Validates the uploaded ZIP against the Anthropic Agent Skills spec:
 * must contain SKILL.md with valid YAML frontmatter (name, description).
 *
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <SkillUploader
 *   org="acme"
 *   onComplete={(skill) => router.push(`/library/skills/${skill.metadata?.org}/${skill.metadata?.slug}`)}
 *   onCancel={() => router.back()}
 * />
 * ```
 */
export function SkillUploader({
  org,
  tag,
  onComplete,
  onCancel,
  className,
}: SkillUploaderProps) {
  const upload = useSkillUpload();
  const { push, isPushing, error: pushError, clearError } = usePushSkill();
  const dupCheck = useSkillDuplicateCheck();

  const handleFileProcessed = useCallback(
    async (file: File) => {
      dupCheck.reset();
      await upload.processFile(file);
    },
    [upload, dupCheck],
  );

  useEffect(() => {
    if (upload.preview && upload.artifact) {
      const slug = normalizeToSlug(upload.preview.name);
      dupCheck.check({ org, slug, artifactBytes: upload.artifact });
    }
  }, [upload.preview, upload.artifact, org]);

  const handlePush = useCallback(async () => {
    if (!upload.artifact) return;
    clearError();

    try {
      const skill = await push({ org, artifact: upload.artifact, tag });
      onComplete?.(skill);
    } catch {
      // Error captured in usePushSkill state
    }
  }, [upload.artifact, clearError, push, org, tag, onComplete]);

  const handleReset = useCallback(() => {
    upload.reset();
    dupCheck.reset();
  }, [upload, dupCheck]);

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-0 stg:rounded-lg stg:border stg:border-border stg:bg-card", className)}>
      {upload.preview ? (
        <PreviewPhase
          preview={upload.preview}
          isPushing={isPushing}
          pushError={pushError}
          onPush={handlePush}
          onReset={handleReset}
          onCancel={onCancel}
          isDuplicate={dupCheck.isDuplicate}
          isCheckingDuplicate={dupCheck.isChecking}
        />
      ) : (
        <DropZonePhase
          onFile={handleFileProcessed}
          isProcessing={upload.isProcessing}
          validationError={upload.validationError}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase 1: Drop Zone
// ---------------------------------------------------------------------------

function DropZonePhase({
  onFile,
  isProcessing,
  validationError,
  onCancel,
}: {
  readonly onFile: (file: File) => Promise<void>;
  readonly isProcessing: boolean;
  readonly validationError: string | null;
  readonly onCancel?: () => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFile(file);
      if (inputRef.current) inputRef.current.value = "";
    },
    [onFile],
  );

  return (
    <div className="stg:flex stg:flex-col">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload skill package"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick(); }}
        className={cn(
          "stg:flex stg:flex-col stg:items-center stg:justify-center stg:gap-3 stg:rounded-lg stg:border-2 stg:border-dashed stg:p-12 stg:transition-colors stg:cursor-pointer",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          isDragOver
            ? "stg:border-primary stg:bg-muted-subtle"
            : "stg:border-border stg:hover:border-muted-foreground stg:hover:bg-muted-subtle",
          isProcessing && "stg:pointer-events-none stg:opacity-60",
        )}
      >
        <UploadIcon className={cn("stg:size-10 stg:text-muted-foreground", isDragOver && "stg:text-primary")} />

        {isProcessing ? (
          <p className="stg:text-sm stg:font-medium stg:text-foreground">Processing...</p>
        ) : (
          <>
            <p className="stg:text-sm stg:font-medium stg:text-foreground">
              Drop your skill package here
            </p>
            <p className="stg:text-xs stg:text-muted-foreground">
              or click to browse
            </p>
          </>
        )}

        <p className="stg:mt-2 stg:text-[10px] stg:text-muted-foreground-subtle">
          Accepts .zip files following the Anthropic Agent Skills format
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          onChange={handleFileChange}
          className="stg:hidden"
          aria-hidden="true"
        />
      </div>

      {validationError && (
        <div className="stg:px-4 stg:py-3">
          <p className="stg:text-sm stg:text-destructive" role="alert">
            {validationError}
          </p>
        </div>
      )}

      {onCancel && (
        <div className="stg:flex stg:justify-end stg:border-t stg:border-border stg:px-4 stg:py-3">
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:text-muted-foreground",
              "stg:hover:text-foreground stg:hover:bg-muted",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:transition-colors",
            )}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase 2: Preview + Confirm
// ---------------------------------------------------------------------------

function PreviewPhase({
  preview,
  isPushing,
  pushError,
  onPush,
  onReset,
  onCancel,
  isDuplicate,
  isCheckingDuplicate,
}: {
  readonly preview: NonNullable<ReturnType<typeof useSkillUpload>["preview"]>;
  readonly isPushing: boolean;
  readonly pushError: Error | null;
  readonly onPush: () => void;
  readonly onReset: () => void;
  readonly onCancel?: () => void;
  readonly isDuplicate?: boolean;
  readonly isCheckingDuplicate?: boolean;
}) {
  const strippedContent = stripFrontmatter(preview.skillMdContent);

  return (
    <div className="stg:flex stg:flex-col">
      {/* Header */}
      <div className="stg:border-b stg:border-border stg:px-4 stg:py-3">
        <h3 className="stg:text-sm stg:font-medium stg:text-foreground">
          Skill Package Preview
        </h3>
      </div>

      {/* Metadata */}
      <div className="stg:flex stg:flex-col stg:gap-2 stg:border-b stg:border-border stg:px-4 stg:py-3">
        <div className="stg:flex stg:items-baseline stg:gap-2">
          <span className="stg:text-xs stg:font-medium stg:text-muted-foreground stg:w-20 stg:shrink-0">Name</span>
          <span className="stg:text-sm stg:font-medium stg:text-foreground stg:font-mono">{preview.name}</span>
        </div>
        {preview.description && (
          <div className="stg:flex stg:items-baseline stg:gap-2">
            <span className="stg:text-xs stg:font-medium stg:text-muted-foreground stg:w-20 stg:shrink-0">Description</span>
            <span className="stg:text-sm stg:text-foreground">{preview.description}</span>
          </div>
        )}
      </div>

      {/* File list */}
      <div className="stg:border-b stg:border-border stg:px-4 stg:py-3">
        <div className="stg:mb-2 stg:flex stg:items-baseline stg:justify-between">
          <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">
            Files ({preview.files.filter((f) => !f.isDirectory).length})
          </span>
          <span className="stg:text-[10px] stg:text-muted-foreground-subtle">
            {formatBytes(preview.totalSize)} total
          </span>
        </div>
        <div className="stg:rounded-md stg:border stg:border-border stg:overflow-hidden">
          <table className="stg:w-full stg:text-xs">
            <tbody>
              {preview.files
                .filter((f) => !f.isDirectory)
                .map((file) => (
                  <tr key={file.path} className="stg:border-b stg:border-border stg:last:border-b-0">
                    <td className="stg:px-3 stg:py-1.5 stg:font-mono stg:text-foreground">{file.path}</td>
                    <td className="stg:px-3 stg:py-1.5 stg:text-right stg:text-muted-foreground stg:tabular-nums">
                      {formatBytes(file.size)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SKILL.md preview */}
      {strippedContent && (
        <div className="stg:border-b stg:border-border stg:px-4 stg:py-3">
          <span className="stg:mb-2 stg:block stg:text-xs stg:font-medium stg:text-muted-foreground">
            SKILL.md Preview
          </span>
          <div className="stg:max-h-[240px] stg:overflow-y-auto stg:rounded-md stg:border stg:border-border stg:p-3">
            <Markdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
              {strippedContent}
            </Markdown>
          </div>
        </div>
      )}

      {/* Duplicate warning */}
      {isDuplicate && (
        <div className="stg:flex stg:items-start stg:gap-2.5 stg:border-b stg:border-amber-500/20 stg:bg-amber-500/5 stg:px-4 stg:py-3" role="alert">
          <WarningIcon className="stg:mt-0.5 stg:size-4 stg:shrink-0 stg:text-amber-600 stg:dark:text-amber-400" />
          <div className="stg:min-w-0 stg:flex-1">
            <p className="stg:text-sm stg:font-medium stg:text-amber-700 stg:dark:text-amber-300">
              No changes detected
            </p>
            <p className="stg:mt-0.5 stg:text-xs stg:text-amber-600 stg:dark:text-amber-400">
              This skill&apos;s content is identical to the current version. Pushing will create a new version record with the same content.
            </p>
          </div>
        </div>
      )}

      {isCheckingDuplicate && (
        <div className="stg:flex stg:items-center stg:gap-2 stg:border-b stg:border-border stg:px-4 stg:py-2">
          <Spinner />
          <span className="stg:text-xs stg:text-muted-foreground">Checking for changes...</span>
        </div>
      )}

      {/* Error */}
      {pushError && (
        <div className="stg:px-4 stg:py-2">
          <p className="stg:text-sm stg:text-destructive" role="alert">
            {pushError.message}
          </p>
        </div>
      )}

      {/* Footer actions */}
      <div className="stg:flex stg:items-center stg:justify-between stg:px-4 stg:py-3">
        <button
          type="button"
          onClick={onReset}
          className={cn(
            "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:text-muted-foreground",
            "stg:hover:text-foreground stg:hover:bg-muted",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            "stg:transition-colors",
          )}
        >
          Choose Different File
        </button>

        <div className="stg:flex stg:items-center stg:gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className={cn(
                "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:text-muted-foreground",
                "stg:hover:text-foreground stg:hover:bg-muted",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                "stg:transition-colors",
              )}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={onPush}
            disabled={isPushing}
            className={cn(
              "stg:rounded-md stg:bg-primary stg:px-4 stg:py-1.5 stg:text-sm stg:font-medium stg:text-primary-foreground",
              "stg:hover:bg-primary-hover",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:disabled:opacity-50 stg:disabled:cursor-not-allowed",
              "stg:transition-colors",
            )}
          >
            {isPushing ? "Pushing..." : isDuplicate ? "Push Anyway" : "Push Skill"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function normalizeToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function WarningIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.5 1 14h14L8 1.5Z" />
      <path d="M8 6v3.5" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="stg:animate-spin" aria-hidden="true">
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}

function UploadIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
