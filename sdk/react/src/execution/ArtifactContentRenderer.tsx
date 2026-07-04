"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import { cn } from "@stigmer/theme";
import {
  MARKDOWN_COMPONENTS,
  REMARK_PLUGINS,
  unwrapEnclosingMarkdownFence,
} from "../internal/markdown-components.js";
import { useRevealLine, type RevealTarget } from "../internal/useRevealLine.js";
import {
  getArtifactRenderMode,
  type ArtifactRenderMode,
} from "./artifact-utils.js";

/** Props for {@link ArtifactContentRenderer}. */
export interface ArtifactContentRendererProps {
  /** The text content to render. */
  readonly content: string;
  /**
   * File name used to determine the rendering strategy
   * (e.g., `"README.md"` → markdown, `"config.yaml"` → YAML).
   */
  readonly fileName: string;
  /**
   * Optional MIME content type from the server. Used as a fallback
   * when the file extension is ambiguous or missing.
   */
  readonly contentType?: string | null;
  /** When `true`, shows a truncation warning below the content. */
  readonly isTruncated?: boolean;
  /**
   * Optional jump-to-line request. When set, the content is rendered
   * **line-faithfully** so the line number maps to the file's real rows —
   * Markdown defaults to its Source view (a line only exists in source) and
   * JSON renders raw rather than pretty-printed (reformatting would shift line
   * numbers) — and the target line is scrolled into view and highlighted. Absent
   * (the default), rendering is unchanged. See {@link RevealTarget}.
   */
  readonly reveal?: RevealTarget;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * File-type-aware content renderer for execution artifacts.
 *
 * Determines the rendering strategy from the file name (via
 * {@link getArtifactRenderMode}) and dispatches to the appropriate
 * view:
 *
 * - **Markdown** (`.md`, `.mdx`) — rendered HTML via `react-markdown`
 *   with themed {@link MARKDOWN_COMPONENTS}, plus a source/rendered
 *   toggle so developers can inspect the raw markup.
 * - **YAML** (`.yaml`, `.yml`) — CSS-only syntax highlighting with
 *   key, comment, and value colorization.
 * - **JSON** (`.json`) — pretty-printed with basic key/value coloring.
 * - **Plain text** (all other extensions) — monospace display with
 *   line numbers.
 *
 * All visual properties flow through `--stgm-*` tokens. The component
 * is self-contained and works identically in the Stigmer Console and
 * in a third-party host application.
 *
 * Platform builders who want to render artifact content outside of
 * {@link ArtifactPreviewModal} can import this component directly:
 *
 * @example
 * ```tsx
 * import { ArtifactContentRenderer, useArtifactContent } from "@stigmer/react";
 *
 * function MyArtifactPanel({ executionId, storageKey, fileName }) {
 *   const { content } = useArtifactContent(executionId, storageKey);
 *   if (!content) return null;
 *   return <ArtifactContentRenderer content={content} fileName={fileName} />;
 * }
 * ```
 *
 * @see {@link getArtifactRenderMode} — pure utility for mode detection
 * @see {@link ArtifactPreviewModal} — full modal that composes this component
 * @see {@link useArtifactContent} — headless content-fetching hook
 */
export function ArtifactContentRenderer({
  content,
  fileName,
  contentType,
  isTruncated = false,
  reveal,
  className,
}: ArtifactContentRendererProps) {
  const mode = getArtifactRenderMode(fileName, contentType);

  return (
    <div className={cn(className)}>
      {mode === "markdown" ? (
        <MarkdownView content={content} reveal={reveal} />
      ) : mode === "yaml" ? (
        <YamlView content={content} reveal={reveal} />
      ) : mode === "json" ? (
        // A reveal needs raw, line-faithful JSON: pretty-printing reformats the
        // file and would shift the target line off its real row.
        reveal ? (
          <LineNumberedPre content={content} reveal={reveal} />
        ) : (
          <JsonView content={content} />
        )
      ) : (
        <PlainTextView content={content} reveal={reveal} />
      )}

      {isTruncated && <TruncationWarning />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown view with source/rendered toggle
// ---------------------------------------------------------------------------

type MarkdownTab = "rendered" | "source";

function MarkdownView({
  content,
  reveal,
}: {
  readonly content: string;
  readonly reveal?: RevealTarget;
}) {
  // A reveal targets a source line (the rendered HTML has no line concept), so
  // default to — and, on every new reveal, return to — the Source view.
  const [tab, setTab] = useState<MarkdownTab>(reveal ? "source" : "rendered");
  // Keyed on the reveal nonce: each fresh jump-to-line returns to Source (where
  // the line exists); switching to Rendered afterward sticks until the next hit.
  useEffect(() => {
    if (reveal) setTab("source");
  }, [reveal?.nonce]);

  // A `.md` whose entire body is one ```markdown fence (e.g. a model-wrapped
  // plan) would render flat. Unwrap for the Rendered view only — Source stays
  // byte-faithful to the stored artifact.
  const rendered = useMemo(
    () => unwrapEnclosingMarkdownFence(content),
    [content],
  );

  return (
    <div>
      <div className="flex items-center border-b border-border px-4 py-1.5">
        <div
          className="inline-flex rounded-md bg-muted p-0.5"
          role="tablist"
          aria-label="View mode"
        >
          <TabButton
            active={tab === "rendered"}
            onClick={() => setTab("rendered")}
            label="Rendered"
          />
          <TabButton
            active={tab === "source"}
            onClick={() => setTab("source")}
            label="Source"
          />
        </div>
      </div>

      {tab === "rendered" ? (
        <div className="p-5">
          <Markdown
            remarkPlugins={REMARK_PLUGINS}
            components={MARKDOWN_COMPONENTS}
          >
            {rendered}
          </Markdown>
        </div>
      ) : (
        <LineNumberedPre content={content} reveal={reveal} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// YAML view (CSS-only syntax highlighting, zero dependencies)
// ---------------------------------------------------------------------------

/**
 * Applies lightweight CSS-only highlighting to YAML content.
 *
 * Processes content line-by-line, wrapping structural tokens in styled
 * `<span>` elements using `--stgm-*` theme tokens:
 *
 * - Keys → `text-primary`
 * - Comments → `text-muted-foreground italic`
 * - Document separators (`---`) → `text-muted-foreground`
 * - Boolean/null values → `font-medium`
 * - Multi-line scalar indicators → `text-muted-foreground`
 *
 * Values and block scalar content render in the default `text-foreground`.
 */
function highlightYamlLine(line: string): ReactNode {
  if (!line.trim()) return line;

  if (/^---\s*$/.test(line) || /^\.\.\.\s*$/.test(line)) {
    return <span className="text-muted-foreground">{line}</span>;
  }

  const commentMatch = line.match(/^(\s*)(#.*)$/);
  if (commentMatch) {
    return (
      <>
        {commentMatch[1]}
        <span className="text-muted-foreground italic">{commentMatch[2]}</span>
      </>
    );
  }

  const kvMatch = line.match(/^(\s*(?:-\s+)?)([\w][\w.-]*)(:(?:\s|$))(.*)/);
  if (kvMatch) {
    const [, indent, key, colon, value] = kvMatch;
    return (
      <>
        {indent}
        <span className="text-primary">{key}</span>
        <span className="text-muted-foreground">{colon}</span>
        {value ? highlightYamlValue(value) : null}
      </>
    );
  }

  return <>{line}</>;
}

function highlightYamlValue(value: string): ReactNode {
  const trimmed = value.trim();

  if (/^[|>][-+]?\s*$/.test(trimmed)) {
    return <span className="text-muted-foreground">{value}</span>;
  }

  if (/^(true|false|null|~)$/.test(trimmed)) {
    return <span className="font-medium">{value}</span>;
  }

  return <>{value}</>;
}

function YamlView({
  content,
  reveal,
}: {
  readonly content: string;
  readonly reveal?: RevealTarget;
}) {
  const { containerRef, isRevealed } = useRevealLine(reveal);
  const lines = content.split("\n");

  return (
    <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground">
      <code ref={containerRef}>
        {lines.map((line, i) => (
          <span
            key={i}
            data-line={i + 1}
            className={cn(
              // Transparent left border by default so revealing a line only
              // changes its color — never shifts the text (no layout jump).
              "block border-l-2 border-transparent",
              isRevealed(i + 1) && "border-primary bg-primary-subtle",
            )}
          >
            {/* whitespace-pre inner + `\n` fallback preserves indentation and
                the height of blank lines, mirroring LineNumberedPre. */}
            <span className="whitespace-pre">
              {line.trim() ? highlightYamlLine(line) : "\n"}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}

// ---------------------------------------------------------------------------
// JSON view (pretty-print + basic key coloring)
// ---------------------------------------------------------------------------

function highlightJson(content: string): ReactNode {
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    formatted = content;
  }

  return formatted.split("\n").map((line, i) => {
    const keyMatch = line.match(/^(\s*)"([^"]+)"(\s*:)(.*)/);
    if (keyMatch) {
      const [, indent, key, colon, rest] = keyMatch;
      return (
        <span key={i}>
          {i > 0 && "\n"}
          {indent}
          <span className="text-primary">&quot;{key}&quot;</span>
          <span className="text-muted-foreground">{colon}</span>
          {highlightJsonValue(rest)}
        </span>
      );
    }
    return (
      <span key={i}>
        {i > 0 && "\n"}
        {line}
      </span>
    );
  });
}

function highlightJsonValue(value: string): ReactNode {
  const trimmed = value.trim().replace(/,\s*$/, "");
  const trailingComma = value.trim().endsWith(",") ? "," : "";

  if (/^".*"$/.test(trimmed)) {
    return (
      <>
        {" "}
        <span className="text-success">{trimmed}</span>
        {trailingComma}
      </>
    );
  }

  if (/^(true|false|null)$/.test(trimmed)) {
    return (
      <>
        {" "}
        <span className="font-medium">{trimmed}</span>
        {trailingComma}
      </>
    );
  }

  if (/^-?\d/.test(trimmed)) {
    return (
      <>
        {" "}
        <span className="text-warning">{trimmed}</span>
        {trailingComma}
      </>
    );
  }

  return <>{value}</>;
}

function JsonView({ content }: { readonly content: string }) {
  return (
    <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground">
      <code>{highlightJson(content)}</code>
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Plain text view (monospace + line numbers)
// ---------------------------------------------------------------------------

function PlainTextView({
  content,
  reveal,
}: {
  readonly content: string;
  readonly reveal?: RevealTarget;
}) {
  return <LineNumberedPre content={content} reveal={reveal} />;
}

/**
 * Line-numbered monospace view. The single line-faithful primitive behind plain
 * text, Markdown Source, and reveal-mode JSON: every row is addressable
 * (`data-line`), so a {@link RevealTarget} can scroll to and highlight a line
 * (via {@link useRevealLine}). Absent a reveal it renders exactly as before.
 */
function LineNumberedPre({
  content,
  reveal,
}: {
  readonly content: string;
  readonly reveal?: RevealTarget;
}) {
  const { containerRef, isRevealed } = useRevealLine(reveal);
  const lines = content.split("\n");
  const gutterWidth = String(lines.length).length;

  return (
    <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground">
      <code ref={containerRef}>
        {lines.map((line, i) => (
          <span
            key={i}
            data-line={i + 1}
            className={cn(
              // Transparent left border by default so a reveal only recolors the
              // row — never shifts its text (no layout jump).
              "flex border-l-2 border-transparent",
              isRevealed(i + 1) && "border-primary bg-primary-subtle",
            )}
          >
            <span
              className="sticky left-0 select-none bg-background pr-4 text-right text-muted-foreground"
              style={{ minWidth: `${gutterWidth + 2}ch` }}
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span className="flex-1 whitespace-pre pl-2">{line || "\n"}</span>
          </span>
        ))}
      </code>
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function TruncationWarning() {
  return (
    <div className="border-t border-border bg-warning/10 px-4 py-2 text-xs text-warning">
      Content was truncated. Download the full file for complete content.
    </div>
  );
}
