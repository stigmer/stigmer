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
    <div className={cn("flex flex-col gap-0 rounded-lg border border-border bg-card", className)}>
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
    <div className="flex flex-col">
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
          "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 transition-colors cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isDragOver
            ? "border-primary bg-muted-subtle"
            : "border-border hover:border-muted-foreground hover:bg-muted-subtle",
          isProcessing && "pointer-events-none opacity-60",
        )}
      >
        <UploadIcon className={cn("size-10 text-muted-foreground", isDragOver && "text-primary")} />

        {isProcessing ? (
          <p className="text-sm font-medium text-foreground">Processing...</p>
        ) : (
          <>
            <p className="text-sm font-medium text-foreground">
              Drop your skill package here
            </p>
            <p className="text-xs text-muted-foreground">
              or click to browse
            </p>
          </>
        )}

        <p className="mt-2 text-[10px] text-muted-foreground-subtle">
          Accepts .zip files following the Anthropic Agent Skills format
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
        />
      </div>

      {validationError && (
        <div className="px-4 py-3">
          <p className="text-sm text-destructive" role="alert">
            {validationError}
          </p>
        </div>
      )}

      {onCancel && (
        <div className="flex justify-end border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground",
              "hover:text-foreground hover:bg-muted",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "transition-colors",
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
    <div className="flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium text-foreground">
          Skill Package Preview
        </h3>
      </div>

      {/* Metadata */}
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-muted-foreground w-20 shrink-0">Name</span>
          <span className="text-sm font-medium text-foreground font-mono">{preview.name}</span>
        </div>
        {preview.description && (
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-muted-foreground w-20 shrink-0">Description</span>
            <span className="text-sm text-foreground">{preview.description}</span>
          </div>
        )}
      </div>

      {/* File list */}
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            Files ({preview.files.filter((f) => !f.isDirectory).length})
          </span>
          <span className="text-[10px] text-muted-foreground-subtle">
            {formatBytes(preview.totalSize)} total
          </span>
        </div>
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-xs">
            <tbody>
              {preview.files
                .filter((f) => !f.isDirectory)
                .map((file) => (
                  <tr key={file.path} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-1.5 font-mono text-foreground">{file.path}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">
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
        <div className="border-b border-border px-4 py-3">
          <span className="mb-2 block text-xs font-medium text-muted-foreground">
            SKILL.md Preview
          </span>
          <div className="max-h-[240px] overflow-y-auto rounded-md border border-border p-3">
            <Markdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
              {strippedContent}
            </Markdown>
          </div>
        </div>
      )}

      {/* Duplicate warning */}
      {isDuplicate && (
        <div className="flex items-start gap-2.5 border-b border-amber-500/20 bg-amber-500/5 px-4 py-3" role="alert">
          <WarningIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              No changes detected
            </p>
            <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
              This skill&apos;s content is identical to the current version. Pushing will create a new version record with the same content.
            </p>
          </div>
        </div>
      )}

      {isCheckingDuplicate && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <Spinner />
          <span className="text-xs text-muted-foreground">Checking for changes...</span>
        </div>
      )}

      {/* Error */}
      {pushError && (
        <div className="px-4 py-2">
          <p className="text-sm text-destructive" role="alert">
            {pushError.message}
          </p>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onReset}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground",
            "hover:text-foreground hover:bg-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "transition-colors",
          )}
        >
          Choose Different File
        </button>

        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground",
                "hover:text-foreground hover:bg-muted",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "transition-colors",
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
              "rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground",
              "hover:bg-primary-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "transition-colors",
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
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true">
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
