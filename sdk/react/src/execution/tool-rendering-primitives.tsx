"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";
import { RevealToggle } from "../internal/RevealToggle.js";

/**
 * Shared truncation threshold for all collapsible tool rendering
 * primitives. Applied consistently across detail views and approval
 * card previews.
 */
export const TRUNCATION_LINE_LIMIT = 10;

// ---------------------------------------------------------------------------
// CollapsibleCode — labeled code block with line-based truncation
// ---------------------------------------------------------------------------

/** Props for {@link CollapsibleCode}. */
export interface CollapsibleCodeProps {
  /** Label displayed above the code block. */
  readonly label: string;
  /** Code content to render. */
  readonly content: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * A labeled `<pre>` block with automatic line-based truncation and
 * an expand/collapse toggle.
 *
 * Used for tool arguments, file content previews, and result blocks
 * across both the detail view and the approval card.
 */
export function CollapsibleCode({ label, content, className }: CollapsibleCodeProps) {
  const lines = content.split("\n");
  const needsTruncation = lines.length > TRUNCATION_LINE_LIMIT;
  const [isExpanded, setIsExpanded] = useState(false);

  const displayContent =
    needsTruncation && !isExpanded
      ? lines.slice(0, TRUNCATION_LINE_LIMIT).join("\n") + "\n\u2026"
      : content;

  return (
    <div className={cn("space-y-1", className)}>
      <span className="font-medium text-muted-foreground">{label}</span>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted-subtle p-2 font-mono text-foreground">
        {displayContent}
      </pre>
      {needsTruncation && (
        <RevealToggle
          expanded={isExpanded}
          onToggle={() => setIsExpanded((v) => !v)}
          moreLabel={`Show all ${lines.length} lines`}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollapsiblePre — raw pre with line-based truncation (no label/border)
// ---------------------------------------------------------------------------

/** Props for {@link CollapsiblePre}. */
export interface CollapsiblePreProps {
  /** Text content to render in the `<pre>` element. */
  readonly content: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * A bare `<pre>` element with line-based truncation. Unlike
 * {@link CollapsibleCode}, this has no label, border, or background
 * — the caller controls container styling via `className`.
 *
 * Pass container styles (border, background, max-height) through
 * `className` when rendering standalone; omit when the parent
 * already provides a styled container (e.g. terminal blocks).
 */
export function CollapsiblePre({ content, className }: CollapsiblePreProps) {
  const lines = content.split("\n");
  const needsTruncation = lines.length > TRUNCATION_LINE_LIMIT;
  const [isExpanded, setIsExpanded] = useState(false);

  const displayContent =
    needsTruncation && !isExpanded
      ? lines.slice(0, TRUNCATION_LINE_LIMIT).join("\n") + "\n\u2026"
      : content;

  return (
    <>
      <pre className={cn("whitespace-pre-wrap break-words font-mono", className)}>
        {displayContent}
      </pre>
      {needsTruncation && (
        <RevealToggle
          expanded={isExpanded}
          onToggle={() => setIsExpanded((v) => !v)}
          moreLabel={`Show all ${lines.length} lines`}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleJsonBlock — chevron-toggled JSON section
// ---------------------------------------------------------------------------

/** Props for {@link CollapsibleJsonBlock}. */
export interface CollapsibleJsonBlockProps {
  /** Label displayed as the toggle header text. */
  readonly label: string;
  /** Pre-formatted JSON content. */
  readonly content: string;
}

/**
 * A collapsible JSON section with a chevron toggle. Initially
 * collapsed, showing the label and line count. Useful for complex
 * (non-scalar) tool arguments.
 */
export function CollapsibleJsonBlock({ label, content }: CollapsibleJsonBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const lines = content.split("\n");
  const isLong = lines.length > 3;

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            "shrink-0 transition-transform duration-150",
            isExpanded && "rotate-90",
          )}
          aria-hidden="true"
        >
          <path d="M2 1L6 4L2 7" />
        </svg>
        {label}
        {!isExpanded && isLong && (
          <span className="font-normal text-muted-foreground-subtle">
            ({lines.length} lines)
          </span>
        )}
      </button>
      {isExpanded && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted-subtle p-2 font-mono text-foreground">
          {content}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

/** Small document icon for file path displays (10x10). */
export function FilePathIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M7 1H3C2.45 1 2 1.45 2 2V10C2 10.55 2.45 11 3 11H9C9.55 11 10 10.55 10 10V4L7 1Z" />
      <path d="M7 1V4H10" />
    </svg>
  );
}

/** MCP server node/link icon (10x10). */
export function McpServerIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <circle cx="6" cy="3" r="1.5" />
      <circle cx="6" cy="9" r="1.5" />
      <path d="M6 4.5V7.5" />
      <path d="M3 6H4.5" />
      <path d="M7.5 6H9" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/** Safely serialise an object to pretty JSON. */
export function formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

/** Pretty-print a result string if it's valid JSON, otherwise return as-is. */
export function formatResult(result: string): string {
  try {
    const parsed = JSON.parse(result);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return result;
  }
}

/** Detect scalar values (string, number, boolean). */
export function isScalar(value: unknown): value is string | number | boolean {
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}

/**
 * Title-case a snake_case or camelCase argument key for display.
 *
 * @example
 * humanizeArgKey("mcp_server_slug") // "Mcp Server Slug"
 */
export function humanizeArgKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
