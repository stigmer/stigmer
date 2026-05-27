"use client";

import { memo, useState, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import type { JsonObject } from "@bufbuild/protobuf";
import {
  CollapsibleJsonBlock,
  formatJson,
  humanizeArgKey,
  isScalar,
} from "../../execution/tool-rendering-primitives";

/**
 * Threshold (in characters) above which a string value is rendered
 * as a wrapped prose paragraph instead of a truncated monospace `<dd>`.
 * Tuned to catch executive summaries, error descriptions, and other
 * natural-language fields while keeping IDs, slugs, and short values
 * in monospace.
 */
const PROSE_CHAR_THRESHOLD = 120;

/**
 * Maximum nesting depth at which the viewer recurses into nested
 * objects with `<dl>` sections. Beyond this depth, values fall back
 * to syntax-highlighted JSON via {@link CollapsibleJsonBlock}.
 */
const MAX_RECURSIVE_DEPTH = 2;

/** Patterns that indicate a string value is an identifier or URL, not prose. */
const ID_URL_PATTERN =
  /^(https?:\/\/|[a-z]{2,6}_[0-9a-zA-Z]{8,}$|[0-9a-f]{8}-[0-9a-f]{4}-|\/[a-z])/;

export interface StructuredDataViewerProps {
  /** The JSON object to render as structured key-value pairs. */
  readonly data: JsonObject;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Type-aware renderer for `JsonObject` task data.
 *
 * Follows the {@link McpArgsView} scalar/complex split pattern:
 * - Scalar values (string, number, boolean) render in a `<dl>` grid
 *   with humanized key labels
 * - Complex values (objects, arrays) render as collapsible sections
 *
 * Extensions beyond `McpArgsView`:
 * - Long strings (> {@link PROSE_CHAR_THRESHOLD}) that are not
 *   IDs/URLs render as wrapped prose paragraphs
 * - Nested objects recurse up to {@link MAX_RECURSIVE_DEPTH}, then
 *   fall back to syntax-highlighted JSON
 * - Arrays of scalars render inline; arrays of objects render as
 *   numbered collapsible items
 */
export const StructuredDataViewer = memo(function StructuredDataViewer({
  data,
  className,
}: StructuredDataViewerProps) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        No data fields
      </p>
    );
  }

  return (
    <div className={cn("space-y-3 text-xs", className)}>
      <ObjectEntries entries={entries} depth={0} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Recursive entry renderer
// ---------------------------------------------------------------------------

function ObjectEntries({
  entries,
  depth,
}: {
  readonly entries: [string, unknown][];
  readonly depth: number;
}) {
  const scalars: [string, unknown][] = [];
  const complex: [string, unknown][] = [];

  for (const [key, value] of entries) {
    if (isScalar(value) || value === null || value === undefined) {
      scalars.push([key, value]);
    } else {
      complex.push([key, value]);
    }
  }

  return (
    <>
      {scalars.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-md border border-border bg-muted-faint px-2.5 py-2">
          {scalars.map(([key, value]) => (
            <ScalarEntry key={key} label={key} value={value} />
          ))}
        </dl>
      )}

      {complex.map(([key, value]) => (
        <ComplexEntry key={key} label={key} value={value} depth={depth} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Scalar entry (inline key-value row)
// ---------------------------------------------------------------------------

function ScalarEntry({
  label,
  value,
}: {
  readonly label: string;
  readonly value: unknown;
}) {
  const strValue = value === null || value === undefined ? "—" : String(value);
  const isLongProse =
    typeof value === "string" &&
    strValue.length > PROSE_CHAR_THRESHOLD &&
    !ID_URL_PATTERN.test(strValue);

  return (
    <>
      <dt className="whitespace-nowrap font-mono text-muted-foreground">
        {humanizeArgKey(label)}
      </dt>
      {isLongProse ? (
        <dd className="min-w-0">
          <ProseValue text={strValue} />
        </dd>
      ) : (
        <dd
          className={cn(
            "min-w-0 font-mono text-foreground",
            typeof value === "boolean" && "font-medium",
            (value === null || value === undefined) && "text-muted-foreground",
          )}
          title={strValue}
        >
          {strValue.includes("\n") ? (
            <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted-subtle px-2 py-1 font-mono text-foreground">
              {strValue}
            </pre>
          ) : (
            <span className="block truncate">{strValue}</span>
          )}
        </dd>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Prose value (long wrapped text with expand/collapse)
// ---------------------------------------------------------------------------

const PROSE_PREVIEW_CHARS = 300;

function ProseValue({ text }: { readonly text: string }) {
  const needsTruncation = text.length > PROSE_PREVIEW_CHARS;
  const [expanded, setExpanded] = useState(false);

  const displayed =
    needsTruncation && !expanded
      ? text.slice(0, PROSE_PREVIEW_CHARS) + "\u2026"
      : text;

  return (
    <div>
      <p className="whitespace-pre-wrap break-words leading-relaxed text-foreground">
        {displayed}
      </p>
      {needsTruncation && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-xs font-medium text-primary transition-colors hover:text-primary-muted"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Complex entry (nested object or array)
// ---------------------------------------------------------------------------

function ComplexEntry({
  label,
  value,
  depth,
}: {
  readonly label: string;
  readonly value: unknown;
  readonly depth: number;
}) {
  if (Array.isArray(value)) {
    return <ArrayEntry label={label} items={value} depth={depth} />;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);

    if (depth + 1 >= MAX_RECURSIVE_DEPTH || entries.length === 0) {
      return (
        <CollapsibleJsonBlock
          label={humanizeArgKey(label)}
          content={formatJson(value)}
        />
      );
    }

    return (
      <NestedSection label={humanizeArgKey(label)}>
        <ObjectEntries entries={entries} depth={depth + 1} />
      </NestedSection>
    );
  }

  return (
    <CollapsibleJsonBlock
      label={humanizeArgKey(label)}
      content={formatJson(value)}
    />
  );
}

// ---------------------------------------------------------------------------
// Array entry
// ---------------------------------------------------------------------------

const INLINE_SCALAR_ARRAY_LIMIT = 5;

function ArrayEntry({
  label,
  items,
  depth,
}: {
  readonly label: string;
  readonly items: unknown[];
  readonly depth: number;
}) {
  if (items.length === 0) {
    return (
      <div className="space-y-1">
        <span className="font-medium text-muted-foreground">
          {humanizeArgKey(label)}
        </span>
        <p className="text-xs text-muted-foreground">Empty array</p>
      </div>
    );
  }

  const allScalars = items.every(
    (item) => isScalar(item) || item === null || item === undefined,
  );

  if (allScalars && items.length <= INLINE_SCALAR_ARRAY_LIMIT) {
    return (
      <div className="space-y-1">
        <span className="font-medium text-muted-foreground">
          {humanizeArgKey(label)}
        </span>
        <p className="font-mono text-foreground">
          {items.map((item) => String(item ?? "null")).join(", ")}
        </p>
      </div>
    );
  }

  return (
    <CollapsibleJsonBlock
      label={`${humanizeArgKey(label)} (${items.length} items)`}
      content={formatJson(items)}
    />
  );
}

// ---------------------------------------------------------------------------
// Nested section (collapsible group for one level of nesting)
// ---------------------------------------------------------------------------

function NestedSection({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
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
            expanded && "rotate-90",
          )}
          aria-hidden="true"
        >
          <path d="M2 1L6 4L2 7" />
        </svg>
        {label}
      </button>
      {expanded && (
        <div className="border-l-2 border-border pl-3">{children}</div>
      )}
    </div>
  );
}
