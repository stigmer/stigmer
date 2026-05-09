"use client";

import {
  type KeyboardEvent,
  type RefObject,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Markdown from "react-markdown";
import { cn } from "@stigmer/theme";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { MARKDOWN_COMPONENTS, REMARK_PLUGINS, stripFrontmatter } from "../internal/markdown-components";
import { useSkillEditor, type SkillEditorMeta } from "./useSkillEditor";
import { usePushSkill } from "./usePushSkill";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Props for {@link SkillEditor}. */
export interface SkillEditorProps {
  /** Organization that will own the skill. */
  readonly org: string;
  /** Existing Markdown body content for edit mode. */
  readonly initialContent?: string;
  /** Existing metadata for edit mode. */
  readonly initialMeta?: SkillEditorMeta;
  /** Version tag for the push (e.g. "stable"). */
  readonly tag?: string;
  /** Called after a successful push with the persisted skill resource. */
  readonly onComplete?: (skill: Skill) => void;
  /** Called when the user cancels editing. */
  readonly onCancel?: () => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;
const CONTENT_LINE_WARNING = 500;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Split-pane Skill editor with live Markdown preview.
 *
 * Creates or edits a single-file skill (SKILL.md). The editor provides:
 * - Metadata form (name + description) that maps to YAML frontmatter
 * - Markdown body editor with formatting toolbar
 * - Live rendered preview using the same pipeline as {@link SkillDetailView}
 * - Keyboard shortcuts for common formatting operations
 * - Responsive layout (side-by-side on desktop, toggle on mobile)
 *
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <SkillEditor
 *   org="acme"
 *   onComplete={(skill) => router.push(`/library/skills/${skill.metadata?.org}/${skill.metadata?.slug}`)}
 *   onCancel={() => router.back()}
 * />
 * ```
 */
export function SkillEditor({
  org,
  initialContent,
  initialMeta,
  tag,
  onComplete,
  onCancel,
  className,
}: SkillEditorProps) {
  const editor = useSkillEditor({ initialContent, initialMeta });
  const { push, isPushing, error: pushError, clearError } = usePushSkill();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSave = useCallback(async () => {
    if (!editor.isValid || isPushing) return;
    clearError();

    try {
      const skillMd = editor.buildSkillMd();
      const skill = await push({ org, skillMd, tag });
      onComplete?.(skill);
    } catch {
      // Error is captured in usePushSkill state
    }
  }, [editor, isPushing, clearError, push, org, tag, onComplete]);

  const handleCancel = useCallback(() => {
    if (editor.isDirty) {
      const confirmed = window.confirm(
        "You have unsaved changes. Are you sure you want to discard them?",
      );
      if (!confirmed) return;
    }
    onCancel?.();
  }, [editor.isDirty, onCancel]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  const lineCount = editor.content.split("\n").length;
  const showLineWarning = lineCount > CONTENT_LINE_WARNING;

  return (
    <div
      className={cn("flex flex-col gap-0 rounded-lg border border-border bg-card", className)}
      onKeyDown={handleKeyDown}
    >
      {/* Metadata form */}
      <SkillMetadataForm
        meta={editor.meta}
        updateMeta={editor.updateMeta}
        validationError={editor.validationError}
      />

      {/* Toolbar */}
      <SkillEditorToolbar
        textareaRef={textareaRef}
        content={editor.content}
        setContent={editor.setContent}
        wordCount={editor.wordCount}
      />

      {/* Editor + Preview split pane */}
      <div className="grid min-h-[400px] grid-cols-1 md:grid-cols-2 border-t border-border">
        {/* Editor pane */}
        <div className="flex flex-col border-b border-border md:border-b-0 md:border-r">
          <textarea
            ref={textareaRef}
            value={editor.content}
            onChange={(e) => editor.setContent(e.target.value)}
            onKeyDown={(e) => handleTextareaKeyDown(e, editor.setContent)}
            placeholder="Write your skill instructions here...&#10;&#10;Use Markdown for formatting: headings, lists, code blocks, etc."
            className={cn(
              "flex-1 resize-none bg-transparent p-4 font-mono text-sm text-foreground",
              "placeholder:text-muted-foreground-subtle",
              "focus:outline-none",
              "min-h-[300px] md:min-h-0",
            )}
            aria-label="Skill content editor"
            spellCheck
          />
        </div>

        {/* Preview pane */}
        <SkillPreviewPane content={editor.content} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border px-4 py-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {showLineWarning && (
            <span className="text-warning">
              {lineCount} lines (Anthropic recommends &lt; {CONTENT_LINE_WARNING})
            </span>
          )}
          {pushError && (
            <span className="text-destructive" role="alert">
              {pushError.message}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={handleCancel}
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
            onClick={handleSave}
            disabled={!editor.isValid || isPushing || !editor.isDirty}
            className={cn(
              "rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground",
              "hover:bg-primary-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "transition-colors",
            )}
          >
            {isPushing ? "Pushing..." : "Push Skill"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metadata form
// ---------------------------------------------------------------------------

function SkillMetadataForm({
  meta,
  updateMeta,
  validationError,
}: {
  readonly meta: SkillEditorMeta;
  readonly updateMeta: (partial: Partial<SkillEditorMeta>) => void;
  readonly validationError: string | null;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="skill-name"
            className="text-xs font-medium text-foreground"
          >
            Name <span className="text-destructive">*</span>
          </label>
          <span className="text-[10px] text-muted-foreground">
            {meta.name.length}/{NAME_MAX}
          </span>
        </div>
        <input
          id="skill-name"
          type="text"
          value={meta.name}
          onChange={(e) => updateMeta({ name: e.target.value })}
          placeholder="my-skill-name"
          maxLength={NAME_MAX}
          aria-invalid={!!validationError}
          aria-describedby={validationError ? "skill-name-error" : undefined}
          className={cn(
            "rounded-md border border-input bg-transparent px-3 py-1.5 text-sm text-foreground",
            "placeholder:text-muted-foreground-subtle",
            "focus:outline-none focus:ring-2 focus:ring-ring",
            validationError && "border-destructive",
          )}
        />
        {validationError && (
          <p id="skill-name-error" className="text-xs text-destructive" role="alert">
            {validationError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="skill-description"
            className="text-xs font-medium text-foreground"
          >
            Description
          </label>
          <span className="text-[10px] text-muted-foreground">
            {meta.description.length}/{DESCRIPTION_MAX}
          </span>
        </div>
        <input
          id="skill-description"
          type="text"
          value={meta.description}
          onChange={(e) => updateMeta({ description: e.target.value })}
          placeholder="What this skill does and when to use it"
          maxLength={DESCRIPTION_MAX}
          className={cn(
            "rounded-md border border-input bg-transparent px-3 py-1.5 text-sm text-foreground",
            "placeholder:text-muted-foreground-subtle",
            "focus:outline-none focus:ring-2 focus:ring-ring",
          )}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

interface ToolbarAction {
  label: string;
  icon: string;
  title: string;
  action: (content: string, textarea: HTMLTextAreaElement) => string;
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    label: "Bold",
    icon: "B",
    title: "Bold (Cmd+B)",
    action: (content, ta) => wrapSelection(content, ta, "**", "**"),
  },
  {
    label: "Italic",
    icon: "I",
    title: "Italic (Cmd+I)",
    action: (content, ta) => wrapSelection(content, ta, "_", "_"),
  },
  {
    label: "Heading",
    icon: "H",
    title: "Heading",
    action: (content, ta) => insertAtLineStart(content, ta, "## "),
  },
  {
    label: "Code",
    icon: "`",
    title: "Inline code",
    action: (content, ta) => wrapSelection(content, ta, "`", "`"),
  },
  {
    label: "Link",
    icon: "🔗",
    title: "Link",
    action: (content, ta) => wrapSelection(content, ta, "[", "](url)"),
  },
  {
    label: "List",
    icon: "•",
    title: "Unordered list",
    action: (content, ta) => insertAtLineStart(content, ta, "- "),
  },
];

function SkillEditorToolbar({
  textareaRef,
  content,
  setContent,
  wordCount,
}: {
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly content: string;
  readonly setContent: (value: string) => void;
  readonly wordCount: number;
}) {
  const handleAction = useCallback(
    (action: ToolbarAction["action"]) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const newContent = action(content, ta);
      setContent(newContent);
      ta.focus();
    },
    [textareaRef, content, setContent],
  );

  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-1.5">
      <div className="flex items-center gap-0.5" role="toolbar" aria-label="Formatting toolbar">
        {TOOLBAR_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            title={action.title}
            onClick={() => handleAction(action.action)}
            className={cn(
              "flex size-7 items-center justify-center rounded text-xs font-medium text-muted-foreground",
              "hover:bg-muted hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "transition-colors",
              action.label === "Bold" && "font-bold",
              action.label === "Italic" && "italic",
            )}
            aria-label={action.label}
          >
            {action.icon}
          </button>
        ))}
      </div>

      <span className="text-[10px] text-muted-foreground tabular-nums">
        {wordCount} {wordCount === 1 ? "word" : "words"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview pane
// ---------------------------------------------------------------------------

function SkillPreviewPane({ content }: { readonly content: string }) {
  const [debouncedContent, setDebouncedContent] = useState(content);

  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(() => {
        setDebouncedContent(content);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [content]);

  const strippedContent = useMemo(
    () => stripFrontmatter(debouncedContent),
    [debouncedContent],
  );

  return (
    <div className="flex flex-col">
      <div className="border-b border-border px-4 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Preview
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {strippedContent ? (
          <Markdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
            {strippedContent}
          </Markdown>
        ) : (
          <p className="text-sm text-muted-foreground-subtle italic">
            Start writing to see a preview...
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Textarea keyboard handling
// ---------------------------------------------------------------------------

function handleTextareaKeyDown(
  e: KeyboardEvent<HTMLTextAreaElement>,
  setContent: (value: string) => void,
) {
  const ta = e.currentTarget;
  const isMod = e.metaKey || e.ctrlKey;

  if (isMod && e.key === "b") {
    e.preventDefault();
    setContent(wrapSelection(ta.value, ta, "**", "**"));
    return;
  }

  if (isMod && e.key === "i") {
    e.preventDefault();
    setContent(wrapSelection(ta.value, ta, "_", "_"));
    return;
  }

  if (e.key === "Tab" && !isMod) {
    e.preventDefault();
    if (e.shiftKey) {
      setContent(dedentAtCursor(ta.value, ta));
    } else {
      setContent(indentAtCursor(ta.value, ta));
    }
  }
}

// ---------------------------------------------------------------------------
// Text manipulation utilities
// ---------------------------------------------------------------------------

function wrapSelection(
  content: string,
  ta: HTMLTextAreaElement,
  prefix: string,
  suffix: string,
): string {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = content.slice(start, end);
  const replacement = `${prefix}${selected || "text"}${suffix}`;
  const newContent = content.slice(0, start) + replacement + content.slice(end);

  requestAnimationFrame(() => {
    if (selected) {
      ta.selectionStart = start + prefix.length;
      ta.selectionEnd = start + prefix.length + selected.length;
    } else {
      ta.selectionStart = start + prefix.length;
      ta.selectionEnd = start + prefix.length + 4; // "text".length
    }
  });

  return newContent;
}

function insertAtLineStart(
  content: string,
  ta: HTMLTextAreaElement,
  prefix: string,
): string {
  const start = ta.selectionStart;
  const lineStart = content.lastIndexOf("\n", start - 1) + 1;
  const newContent = content.slice(0, lineStart) + prefix + content.slice(lineStart);

  requestAnimationFrame(() => {
    ta.selectionStart = start + prefix.length;
    ta.selectionEnd = start + prefix.length;
  });

  return newContent;
}

function indentAtCursor(content: string, ta: HTMLTextAreaElement): string {
  const start = ta.selectionStart;
  const indent = "  ";
  const newContent = content.slice(0, start) + indent + content.slice(start);

  requestAnimationFrame(() => {
    ta.selectionStart = start + indent.length;
    ta.selectionEnd = start + indent.length;
  });

  return newContent;
}

function dedentAtCursor(content: string, ta: HTMLTextAreaElement): string {
  const start = ta.selectionStart;
  const lineStart = content.lastIndexOf("\n", start - 1) + 1;
  const lineContent = content.slice(lineStart);

  if (lineContent.startsWith("  ")) {
    const newContent = content.slice(0, lineStart) + lineContent.slice(2);
    requestAnimationFrame(() => {
      ta.selectionStart = Math.max(lineStart, start - 2);
      ta.selectionEnd = Math.max(lineStart, start - 2);
    });
    return newContent;
  }

  return content;
}
