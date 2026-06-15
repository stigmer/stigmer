import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

/**
 * A single selectable entry in a {@link ResourcePicker}.
 *
 * Callers map their domain objects (agents, sessions, ...) into this shape and
 * receive the chosen item back via `onSelect`. The picker is domain-agnostic:
 * it knows only how to render and navigate these rows.
 */
export interface PickerItem {
  /** Opaque identity returned to the caller on selection. */
  readonly id: string;
  /** Primary display text, rendered bold when active (e.g. "acme/deploy"). */
  readonly title: string;
  /** Secondary text, rendered dimmed after the title (e.g. a description). */
  readonly subtitle?: string;
  /** Right-aligned metadata, rendered dimmed (e.g. "2 hours ago"). */
  readonly meta?: string;
}

/** Props for {@link ResourcePicker}. */
export interface ResourcePickerProps {
  /** The current result rows to choose from (owned by the caller). */
  readonly items: readonly PickerItem[];
  /** Current query text (controlled — the caller owns search state). */
  readonly query: string;
  /** Called when the query text changes; the caller re-runs its search. */
  readonly onQueryChange: (query: string) => void;
  /** Called with the chosen item when the user presses Enter. */
  readonly onSelect: (item: PickerItem) => void;
  /** Called when the user cancels (Esc or Ctrl+C). */
  readonly onCancel: () => void;
  /** `true` while a search request is in flight. */
  readonly isLoading?: boolean;
  /** Error from the last failed search, shown in place of the list. */
  readonly error?: Error | null;
  /** Label shown before the input (e.g. "Select an agent"). */
  readonly prompt?: string;
  /** Placeholder shown in the empty input. */
  readonly placeholder?: string;
  /** Label shown when a completed search returns no rows. */
  readonly emptyLabel?: string;
}

/** Maximum rows shown at once; the list scrolls a window around the cursor. */
const MAX_VISIBLE = 10;

/**
 * Generic, interactive search-and-select list for the terminal.
 *
 * Renders a text input above a scrollable result list. The user types to
 * filter (the caller performs the actual search via `onQueryChange`), navigates
 * with the arrow keys, selects with Enter, and cancels with Esc. It holds no
 * data of its own — pass `items`/`query`/`isLoading` from a data hook such as
 * `useAgentSearch` or `useSessionList`.
 *
 * This is the reusable organism behind {@link AgentPicker} and
 * {@link SessionPicker}; platform builders can compose it with any search
 * function to pick any resource.
 *
 * @example
 * ```tsx
 * const { results, isLoading, query, setQuery } = useAgentSearch("acme");
 * const items = results.map((r) => ({ id: r.id, title: r.qualifiedSlug }));
 * render(
 *   <ResourcePicker
 *     prompt="Select an agent"
 *     items={items}
 *     query={query}
 *     onQueryChange={setQuery}
 *     isLoading={isLoading}
 *     onSelect={(item) => console.log(item.id)}
 *     onCancel={() => process.exit(0)}
 *   />,
 * );
 * ```
 */
export function ResourcePicker({
  items,
  query,
  onQueryChange,
  onSelect,
  onCancel,
  isLoading = false,
  error = null,
  prompt = "Search",
  placeholder = "type to search...",
  emptyLabel = "no results",
}: ResourcePickerProps) {
  const [cursor, setCursor] = useState(0);

  // Reset the cursor to the top whenever the query changes — the result set is
  // about to be replaced, so a stale cursor would point at the wrong row.
  useEffect(() => {
    setCursor(0);
  }, [query]);

  const active = items.length === 0 ? 0 : Math.min(cursor, items.length - 1);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) {
      onCancel();
      return;
    }
    if (key.return) {
      if (items.length > 0) onSelect(items[active]);
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, Math.min(c, items.length - 1) - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(items.length - 1, c + 1));
    }
  });

  const [start, end] = visibleWindow(active, items.length);

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color="cyan" bold>
          ?
        </Text>
        <Text bold>{prompt}:</Text>
        <TextInput value={query} onChange={onQueryChange} placeholder={placeholder} />
      </Box>

      <Box marginTop={1} flexDirection="column">
        {error !== null ? (
          <Text color="red">{`  Error: ${error.message}`}</Text>
        ) : isLoading ? (
          <Text dimColor>  searching...</Text>
        ) : items.length === 0 ? (
          <Text dimColor>{`  ${emptyLabel}`}</Text>
        ) : (
          <>
            {items.slice(start, end).map((item, i) => (
              <PickerRow key={item.id} item={item} isActive={start + i === active} />
            ))}
            <Box marginTop={1}>
              <Text dimColor>{`  ${countLabel(items.length)}  |  up/down: navigate  |  enter: select  |  esc: cancel`}</Text>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}

/** One result row: a cursor glyph, the title, then optional subtitle/meta. */
function PickerRow({ item, isActive }: { readonly item: PickerItem; readonly isActive: boolean }) {
  return (
    <Box>
      <Text color={isActive ? "cyan" : undefined}>{isActive ? "❯ " : "  "}</Text>
      <Text color={isActive ? "cyan" : undefined} bold={isActive}>
        {item.title}
      </Text>
      {item.subtitle !== undefined && item.subtitle !== "" ? <Text dimColor>{`  ${item.subtitle}`}</Text> : null}
      {item.meta !== undefined && item.meta !== "" ? <Text dimColor>{`  ${item.meta}`}</Text> : null}
    </Box>
  );
}

/** "1 result" / "N results" — matches the Go picker's footer wording. */
function countLabel(count: number): string {
  return `${count} result${count === 1 ? "" : "s"}`;
}

/**
 * Compute the visible slice `[start, end)` so the active row stays in view,
 * centering the cursor once the list grows past {@link MAX_VISIBLE}.
 */
function visibleWindow(active: number, total: number): readonly [number, number] {
  if (total <= MAX_VISIBLE) return [0, total];
  const half = Math.floor(MAX_VISIBLE / 2);
  let start = Math.max(0, active - half);
  let end = start + MAX_VISIBLE;
  if (end > total) {
    end = total;
    start = end - MAX_VISIBLE;
  }
  return [start, end];
}
