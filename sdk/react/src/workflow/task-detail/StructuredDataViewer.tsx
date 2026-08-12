"use client";

import { memo, useState, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import type { JsonObject } from "@bufbuild/protobuf";
import {
  CollapsibleJsonBlock,
  formatJson,
  humanizeArgKey,
  isScalar,
} from "../../execution/tool-rendering-primitives.js";
import { TruncatedText } from "../../internal/truncated-text.js";

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
 * to syntax-highlighted JSON via {@link CollapsibleJsonBlock} —
 * unless the nested value contains only scalar leaves, in which case
 * the structured view is used regardless of depth (see
 * {@link isAllScalarEntries}).
 */
const MAX_RECURSIVE_DEPTH = 5;

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
      <p className={cn("stg:text-xs stg:text-muted-foreground", className)}>
        No data fields
      </p>
    );
  }

  return (
    <div className={cn("stg:space-y-3 stg:text-xs", className)}>
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
        <dl className="stg:grid stg:grid-cols-[auto_1fr] stg:gap-x-3 stg:gap-y-1.5 stg:rounded-md stg:border stg:border-border stg:bg-muted-faint stg:px-2.5 stg:py-2">
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
      <dt className="stg:whitespace-nowrap stg:font-mono stg:text-muted-foreground">
        {humanizeArgKey(label)}
      </dt>
      {isLongProse ? (
        <dd className="stg:min-w-0">
          <ProseValue text={strValue} />
        </dd>
      ) : (
        <dd
          className={cn(
            "stg:min-w-0 stg:font-mono stg:text-foreground",
            typeof value === "boolean" && "stg:font-medium",
            (value === null || value === undefined) && "stg:text-muted-foreground",
          )}
        >
          {strValue.includes("\n") ? (
            // Multiline values wrap fully in the <pre> — nothing is clipped,
            // so no tooltip is needed.
            <pre className="stg:whitespace-pre-wrap stg:break-words stg:rounded stg:border stg:border-border stg:bg-muted-subtle stg:px-2 stg:py-1 stg:font-mono stg:text-foreground">
              {strValue}
            </pre>
          ) : (
            <TruncatedText text={strValue} className="stg:block" />
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
      <p className="stg:whitespace-pre-wrap stg:break-words stg:leading-relaxed stg:text-foreground">
        {displayed}
      </p>
      {needsTruncation && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="stg:mt-0.5 stg:text-xs stg:font-medium stg:text-primary stg:transition-colors stg:hover:text-primary-muted"
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

    if (entries.length === 0) {
      return (
        <CollapsibleJsonBlock
          label={humanizeArgKey(label)}
          content={formatJson(value)}
        />
      );
    }

    if (
      depth + 1 >= MAX_RECURSIVE_DEPTH &&
      !isAllScalarEntries(entries)
    ) {
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

/**
 * Keys checked (in priority order) to extract a human-readable label
 * from an object array item. The first key found with a scalar value
 * is used as the item subtitle.
 */
const ITEM_LABEL_KEYS = ["name", "title", "label", "id"] as const;

/** Above this count, individual items start collapsed to avoid viewport flood. */
const AUTO_COLLAPSE_ITEM_THRESHOLD = 3;

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
      <div className="stg:flex stg:items-baseline stg:gap-1.5">
        <span className="stg:font-medium stg:text-muted-foreground">
          {humanizeArgKey(label)}
        </span>
        <span className="stg:text-muted-foreground-subtle">(0 items)</span>
      </div>
    );
  }

  const allScalars = items.every(
    (item) => isScalar(item) || item === null || item === undefined,
  );

  if (allScalars && items.length <= INLINE_SCALAR_ARRAY_LIMIT) {
    return (
      <div className="stg:space-y-1">
        <span className="stg:font-medium stg:text-muted-foreground">
          {humanizeArgKey(label)}
        </span>
        <p className="stg:font-mono stg:text-foreground">
          {items.map((item) => String(item ?? "null")).join(", ")}
        </p>
      </div>
    );
  }

  const allObjects = items.every(
    (item) => typeof item === "object" && item !== null && !Array.isArray(item),
  );

  const objectItems = items as Record<string, unknown>[];

  if (
    allObjects &&
    (depth < MAX_RECURSIVE_DEPTH ||
      isAllScalarObjectArray(objectItems))
  ) {
    return (
      <ObjectArraySection
        label={label}
        items={objectItems}
        depth={depth}
      />
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
// Object array section (structured rendering for arrays of objects)
// ---------------------------------------------------------------------------

function ObjectArraySection({
  label,
  items,
  depth,
}: {
  readonly label: string;
  readonly items: readonly Record<string, unknown>[];
  readonly depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const defaultItemExpanded = items.length <= AUTO_COLLAPSE_ITEM_THRESHOLD;

  return (
    <div className="stg:space-y-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="stg:flex stg:items-center stg:gap-1 stg:font-medium stg:text-muted-foreground stg:transition-colors stg:hover:text-foreground"
      >
        <ChevronIcon expanded={expanded} />
        {humanizeArgKey(label)}{" "}
        <span className="stg:font-normal stg:text-muted-foreground-subtle">
          ({items.length} {items.length === 1 ? "item" : "items"})
        </span>
      </button>
      {expanded && (
        <div className="stg:space-y-1.5 stg:border-l-2 stg:border-border stg:pl-3">
          {items.map((item, index) => (
            <ObjectArrayItem
              key={index}
              item={item}
              index={index}
              depth={depth}
              defaultExpanded={defaultItemExpanded}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectArrayItem({
  item,
  index,
  depth,
  defaultExpanded,
}: {
  readonly item: Record<string, unknown>;
  readonly index: number;
  readonly depth: number;
  readonly defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const entries = Object.entries(item);
  const subtitle = extractItemLabel(item);

  const itemLabel = subtitle
    ? `Item ${index + 1} \u2014 ${subtitle}`
    : `Item ${index + 1}`;

  if (entries.length === 0) {
    return (
      <div className="stg:text-muted-foreground">
        {itemLabel}{" "}
        <span className="stg:font-normal stg:text-muted-foreground-subtle">
          (empty)
        </span>
      </div>
    );
  }

  return (
    <div className="stg:space-y-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="stg:flex stg:items-center stg:gap-1 stg:text-muted-foreground stg:transition-colors stg:hover:text-foreground"
      >
        <ChevronIcon expanded={expanded} />
        <span className="stg:font-medium">{`Item ${index + 1}`}</span>
        {subtitle && (
          <span className="stg:font-normal stg:text-muted-foreground-subtle">
            &mdash; {subtitle}
          </span>
        )}
      </button>
      {expanded && (
        <div className="stg:border-l-2 stg:border-border stg:pl-3">
          <ObjectEntries entries={entries} depth={depth + 1} />
        </div>
      )}
    </div>
  );
}

/**
 * Scans an object for a well-known label key and returns its scalar
 * value as a string, or `null` if none found.
 */
function extractItemLabel(item: Record<string, unknown>): string | null {
  for (const key of ITEM_LABEL_KEYS) {
    const value = item[key];
    if (isScalar(value)) return String(value);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scalar-leaf bypass
// ---------------------------------------------------------------------------

/**
 * Returns `true` when every value in the entry list is a scalar
 * (string, number, boolean) or nullish. Used to bypass the
 * {@link MAX_RECURSIVE_DEPTH} gate for terminal objects that contain
 * no further complex nesting — rendering them as a structured `<dl>`
 * grid is always safe and more readable than a JSON block.
 */
function isAllScalarEntries(
  entries: readonly [string, unknown][],
): boolean {
  return entries.every(
    ([, value]) => isScalar(value) || value === null || value === undefined,
  );
}

/**
 * Returns `true` when every item in an object array contains only
 * scalar (or nullish) values. When this holds, the array can be
 * rendered as structured collapsible items regardless of depth.
 */
function isAllScalarObjectArray(
  items: readonly Record<string, unknown>[],
): boolean {
  return items.every((item) => isAllScalarEntries(Object.entries(item)));
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
    <div className="stg:space-y-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="stg:flex stg:items-center stg:gap-1 stg:font-medium stg:text-muted-foreground stg:transition-colors stg:hover:text-foreground"
      >
        <ChevronIcon expanded={expanded} />
        {label}
      </button>
      {expanded && (
        <div className="stg:border-l-2 stg:border-border stg:pl-3">{children}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared chevron icon for collapsible sections
// ---------------------------------------------------------------------------

function ChevronIcon({ expanded }: { readonly expanded: boolean }) {
  return (
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
        "stg:shrink-0 stg:transition-transform stg:duration-150",
        expanded && "stg:rotate-90",
      )}
      aria-hidden="true"
    >
      <path d="M2 1L6 4L2 7" />
    </svg>
  );
}
