"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Skill metadata fields that map to YAML frontmatter in SKILL.md. */
export interface SkillEditorMeta {
  /** Human-friendly skill name (max 64 chars, lowercase + hyphens). */
  readonly name: string;
  /** What the skill does and when to use it (max 1024 chars). */
  readonly description: string;
}

/** Options for initializing the skill editor (edit mode vs. create mode). */
export interface UseSkillEditorOptions {
  /**
   * Existing Markdown body content (without frontmatter) for edit mode.
   * When omitted, the editor starts empty (create mode).
   */
  readonly initialContent?: string;
  /**
   * Existing metadata for edit mode.
   * When omitted, the editor starts with empty metadata (create mode).
   */
  readonly initialMeta?: SkillEditorMeta;
}

/** Return value of {@link useSkillEditor}. */
export interface UseSkillEditorReturn {
  /** Current metadata (maps to YAML frontmatter). */
  readonly meta: SkillEditorMeta;
  /** Update one or more metadata fields. */
  readonly updateMeta: (partial: Partial<SkillEditorMeta>) => void;

  /** Current Markdown body content (no frontmatter). */
  readonly content: string;
  /** Replace the Markdown body content. */
  readonly setContent: (value: string) => void;

  /** Whether the editor has unsaved changes relative to initial state. */
  readonly isDirty: boolean;
  /** Word count of the Markdown body. */
  readonly wordCount: number;
  /** Character count of the Markdown body. */
  readonly charCount: number;
  /** Whether the current state passes validation. */
  readonly isValid: boolean;
  /** Human-readable validation error, or `null` if valid. */
  readonly validationError: string | null;

  /**
   * Assembles the complete SKILL.md content (frontmatter + body)
   * ready for packaging and push.
   */
  readonly buildSkillMd: () => string;

  /** Reset editor to its initial state (discards unsaved changes). */
  readonly reset: () => void;
}

// ---------------------------------------------------------------------------
// Frontmatter utilities
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parses a raw SKILL.md string into separated meta and body content.
 * Preserves unknown frontmatter fields in a passthrough map so they
 * survive round-trip editing without data loss.
 */
export function parseSkillMd(raw: string): {
  meta: SkillEditorMeta;
  body: string;
  extraFrontmatter: Record<string, unknown>;
} {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return {
      meta: { name: "", description: "" },
      body: raw,
      extraFrontmatter: {},
    };
  }

  const frontmatterStr = match[1];
  const body = raw.slice(match[0].length);

  let parsed: Record<string, unknown> = {};
  try {
    parsed = (parseYaml(frontmatterStr) as Record<string, unknown>) ?? {};
  } catch {
    return {
      meta: { name: "", description: "" },
      body: raw,
      extraFrontmatter: {},
    };
  }

  const name = typeof parsed.name === "string" ? parsed.name : "";
  const description =
    typeof parsed.description === "string" ? parsed.description : "";

  const { name: _n, description: _d, ...extraFrontmatter } = parsed;

  return { meta: { name, description }, body, extraFrontmatter };
}

/**
 * Serializes metadata and body content into a complete SKILL.md string.
 * Preserves any extra frontmatter fields from the original file.
 */
export function buildSkillMdContent(
  meta: SkillEditorMeta,
  body: string,
  extraFrontmatter?: Record<string, unknown>,
): string {
  const frontmatterObj: Record<string, unknown> = {
    name: meta.name,
    description: meta.description || undefined,
    ...extraFrontmatter,
  };

  // Remove undefined values so YAML output stays clean
  const cleaned = Object.fromEntries(
    Object.entries(frontmatterObj).filter(([, v]) => v !== undefined && v !== ""),
  );

  const yamlStr = stringifyYaml(cleaned, { lineWidth: 0 }).trimEnd();
  const separator = "---";

  return `${separator}\n${yamlStr}\n${separator}\n${body}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const NAME_MAX_LENGTH = 64;
const DESCRIPTION_MAX_LENGTH = 1024;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function validate(meta: SkillEditorMeta): string | null {
  if (!meta.name.trim()) {
    return "Name is required";
  }
  if (meta.name.length > NAME_MAX_LENGTH) {
    return `Name must be ${NAME_MAX_LENGTH} characters or fewer`;
  }
  if (!NAME_PATTERN.test(meta.name)) {
    return "Name must contain only lowercase letters, numbers, and hyphens, starting with a letter or number";
  }
  if (meta.description.length > DESCRIPTION_MAX_LENGTH) {
    return `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Word count utility
// ---------------------------------------------------------------------------

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/**
 * Behavior hook for the Skill editor.
 *
 * Manages content state, metadata form state, dirty tracking, validation,
 * and frontmatter serialization — providing all the logic a skill editor
 * UI needs without being coupled to any specific rendering approach.
 *
 * Platform builders who want a custom skill editor UI can use this hook
 * directly with their own components.
 *
 * @example
 * ```tsx
 * const editor = useSkillEditor({ initialMeta: { name: "my-skill", description: "" } });
 *
 * return (
 *   <div>
 *     <input value={editor.meta.name} onChange={e => editor.updateMeta({ name: e.target.value })} />
 *     <textarea value={editor.content} onChange={e => editor.setContent(e.target.value)} />
 *     <button disabled={!editor.isValid} onClick={() => push({ org, skillMd: editor.buildSkillMd() })}>
 *       Save
 *     </button>
 *   </div>
 * );
 * ```
 */
export function useSkillEditor(
  options: UseSkillEditorOptions = {},
): UseSkillEditorReturn {
  const { initialContent = "", initialMeta } = options;

  const defaultMeta: SkillEditorMeta = initialMeta ?? {
    name: "",
    description: "",
  };

  const [meta, setMeta] = useState<SkillEditorMeta>(defaultMeta);
  const [content, setContent] = useState(initialContent);

  // Preserve extra frontmatter fields from existing skills for round-trip safety
  const extraFrontmatterRef = useRef<Record<string, unknown>>({});

  const initialMetaRef = useRef(defaultMeta);
  const initialContentRef = useRef(initialContent);

  const updateMeta = useCallback(
    (partial: Partial<SkillEditorMeta>) => {
      setMeta((prev) => ({ ...prev, ...partial }));
    },
    [],
  );

  const isDirty = useMemo(() => {
    return (
      meta.name !== initialMetaRef.current.name ||
      meta.description !== initialMetaRef.current.description ||
      content !== initialContentRef.current
    );
  }, [meta, content]);

  const wordCount = useMemo(() => countWords(content), [content]);
  const charCount = content.length;

  const validationError = useMemo(() => validate(meta), [meta]);
  const isValid = validationError === null;

  const buildSkillMd = useCallback(
    () => buildSkillMdContent(meta, content, extraFrontmatterRef.current),
    [meta, content],
  );

  const reset = useCallback(() => {
    setMeta(initialMetaRef.current);
    setContent(initialContentRef.current);
  }, []);

  return {
    meta,
    updateMeta,
    content,
    setContent,
    isDirty,
    wordCount,
    charCount,
    isValid,
    validationError,
    buildSkillMd,
    reset,
  };
}

/**
 * Creates initial editor options from a raw SKILL.md string.
 *
 * Use this when loading an existing skill for editing — it parses the
 * frontmatter into structured metadata and separates the body content.
 * Pass the returned object as options to {@link useSkillEditor}.
 */
export function createEditorOptionsFromSkillMd(
  rawSkillMd: string,
): UseSkillEditorOptions & { extraFrontmatter: Record<string, unknown> } {
  const { meta, body, extraFrontmatter } = parseSkillMd(rawSkillMd);
  return { initialMeta: meta, initialContent: body, extraFrontmatter };
}
