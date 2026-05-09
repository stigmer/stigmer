"use client";

import { useCallback, useRef, useState } from "react";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single file entry within a skill ZIP package. */
export interface SkillFileEntry {
  /** Relative path within the ZIP (e.g. "SKILL.md", "scripts/validate.py"). */
  readonly path: string;
  /** Uncompressed file size in bytes. */
  readonly size: number;
  /** Whether this entry represents a directory. */
  readonly isDirectory: boolean;
}

/** Preview metadata extracted from a validated skill package. */
export interface SkillUploadPreview {
  /** Skill name extracted from SKILL.md YAML frontmatter. */
  readonly name: string;
  /** Skill description extracted from SKILL.md YAML frontmatter. */
  readonly description: string;
  /** All files contained in the ZIP package. */
  readonly files: SkillFileEntry[];
  /** Raw SKILL.md content (frontmatter + body). */
  readonly skillMdContent: string;
  /** Total uncompressed size of all files in bytes. */
  readonly totalSize: number;
}

/** Return value of {@link useSkillUpload}. */
export interface UseSkillUploadReturn {
  /** Validated preview of the uploaded package, or `null` before upload. */
  readonly preview: SkillUploadPreview | null;
  /** Validation error message, or `null` if valid/not yet uploaded. */
  readonly validationError: string | null;
  /** `true` while the file is being read and validated. */
  readonly isProcessing: boolean;
  /** Process a file selected by the user (triggers validation). */
  readonly processFile: (file: File) => Promise<void>;
  /** Reset to initial state (clear preview and errors). */
  readonly reset: () => void;
  /** Raw ZIP bytes ready for push, or `null` before successful validation. */
  readonly artifact: Uint8Array | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZIP_MAGIC_BYTES = [0x50, 0x4b, 0x03, 0x04];
const NAME_MAX_LENGTH = 64;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/**
 * Behavior hook for the skill upload workflow.
 *
 * Handles file reading, ZIP unpacking, structure validation, and
 * metadata extraction. Produces a {@link SkillUploadPreview} that
 * the UI can render, and exposes the raw artifact bytes for pushing.
 *
 * Validation rules (Anthropic Agent Skills spec):
 * - File must be a valid ZIP archive (checked via magic bytes)
 * - ZIP must contain `SKILL.md` at the root level
 * - SKILL.md must have YAML frontmatter with a valid `name` field
 * - Name must be lowercase letters/numbers/hyphens, max 64 chars
 *
 * @example
 * ```tsx
 * const upload = useSkillUpload();
 *
 * const handleDrop = (file: File) => upload.processFile(file);
 *
 * if (upload.preview) {
 *   // Show preview UI
 *   console.log(upload.preview.name, upload.preview.files);
 * }
 *
 * if (upload.artifact) {
 *   // Ready to push
 *   await push({ org: "acme", artifact: upload.artifact });
 * }
 * ```
 */
export function useSkillUpload(): UseSkillUploadReturn {
  const [preview, setPreview] = useState<SkillUploadPreview | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [artifact, setArtifact] = useState<Uint8Array | null>(null);

  const abortRef = useRef(0);

  const reset = useCallback(() => {
    abortRef.current++;
    setPreview(null);
    setValidationError(null);
    setIsProcessing(false);
    setArtifact(null);
  }, []);

  const processFile = useCallback(async (file: File) => {
    const callId = ++abortRef.current;
    setIsProcessing(true);
    setValidationError(null);
    setPreview(null);
    setArtifact(null);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());

      if (abortRef.current !== callId) return;

      if (!isZip(bytes)) {
        setValidationError("File is not a valid ZIP archive");
        return;
      }

      const { unzipSync, strFromU8 } = await import("fflate");
      const unzipped = unzipSync(bytes);

      if (abortRef.current !== callId) return;

      const entries = Object.entries(unzipped);
      const skillMdEntry = findSkillMd(entries);

      if (!skillMdEntry) {
        setValidationError("ZIP must contain a SKILL.md file at the root level");
        return;
      }

      const skillMdContent = strFromU8(skillMdEntry[1]);
      const frontmatter = parseFrontmatter(skillMdContent);

      if (!frontmatter) {
        setValidationError("SKILL.md must have valid YAML frontmatter (---\\n...\\n---)");
        return;
      }

      if (!frontmatter.name || typeof frontmatter.name !== "string") {
        setValidationError("SKILL.md frontmatter must include a 'name' field");
        return;
      }

      const name = frontmatter.name;
      if (name.length > NAME_MAX_LENGTH) {
        setValidationError(`Skill name must be ${NAME_MAX_LENGTH} characters or fewer`);
        return;
      }

      if (!NAME_PATTERN.test(name)) {
        setValidationError(
          "Skill name must contain only lowercase letters, numbers, and hyphens, starting with a letter or number",
        );
        return;
      }

      const files: SkillFileEntry[] = entries.map(([path, data]) => ({
        path,
        size: data.length,
        isDirectory: data.length === 0 && path.endsWith("/"),
      }));

      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      const description =
        typeof frontmatter.description === "string"
          ? frontmatter.description
          : "";

      if (abortRef.current !== callId) return;

      setPreview({ name, description, files, skillMdContent, totalSize });
      setArtifact(bytes);
    } catch (err) {
      if (abortRef.current !== callId) return;
      const message =
        err instanceof Error ? err.message : "Failed to process file";
      setValidationError(`Invalid ZIP archive: ${message}`);
    } finally {
      if (abortRef.current === callId) {
        setIsProcessing(false);
      }
    }
  }, []);

  return { preview, validationError, isProcessing, processFile, reset, artifact };
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

function isZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return (
    bytes[0] === ZIP_MAGIC_BYTES[0] &&
    bytes[1] === ZIP_MAGIC_BYTES[1] &&
    bytes[2] === ZIP_MAGIC_BYTES[2] &&
    bytes[3] === ZIP_MAGIC_BYTES[3]
  );
}

function findSkillMd(
  entries: [string, Uint8Array][],
): [string, Uint8Array] | undefined {
  return entries.find(
    ([path]) => path === "SKILL.md" || path.match(/^[^/]+\/SKILL\.md$/),
  );
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;

  try {
    const parsed = parseYaml(match[1]);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
