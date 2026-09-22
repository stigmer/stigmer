import React, { useCallback, useEffect, useMemo } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { BUILT_IN_ASSISTANT_NAME, useAgentSearch } from "@stigmer/react";
import { type PickerItem, ResourcePicker } from "./ResourcePicker.js";

/** Props for {@link AgentPicker}. */
export interface AgentPickerProps {
  /** Organization to search within. */
  readonly org: string;
  /** Seeds the search box (e.g. an unresolved slug the user already typed). */
  readonly initialQuery?: string;
  /** Called with the chosen agent's search result on selection. */
  readonly onSelect: (agent: SearchResult) => void;
  /**
   * When given, the list opens with the built-in assistant — the answer a
   * session gets with no agent at all — as its first row, and choosing it
   * calls this instead of `onSelect`. Absent, the picker offers agents only
   * (a caller that needs an agent, such as a schedule, leaves it out).
   */
  readonly onSelectBuiltInAssistant?: () => void;
  /** Called when the user cancels (Esc / Ctrl+C). */
  readonly onCancel: () => void;
}

/** Max description length shown as the row subtitle before truncation. */
const SUBTITLE_MAX = 60;

/**
 * The built-in assistant's row id: no agent carries an empty id, so it cannot
 * collide with a search result, and it reads as what it is on the wire (an
 * empty `agentInstanceId` is the built-in assistant).
 */
const BUILT_IN_ASSISTANT_ITEM_ID = "";

const BUILT_IN_ASSISTANT_ITEM: PickerItem = {
  id: BUILT_IN_ASSISTANT_ITEM_ID,
  title: `${BUILT_IN_ASSISTANT_NAME} (built-in)`,
  subtitle: "No agent: answers with the tools the conversation carries",
};

/**
 * Interactive picker for choosing an agent by name.
 *
 * Composes the {@link useAgentSearch} data hook with {@link ResourcePicker}:
 * the user types, results stream in (debounced by the hook), and the selected
 * agent's {@link SearchResult} is returned via `onSelect`. Use the `id` field of
 * that result to resolve and run the agent.
 *
 * @example
 * ```tsx
 * render(
 *   <InkStigmerProvider client={client}>
 *     <AgentPicker org="acme" onSelect={(a) => run(a.id)} onCancel={() => process.exit(0)} />
 *   </InkStigmerProvider>,
 * );
 * ```
 */
export function AgentPicker({
  org,
  initialQuery,
  onSelect,
  onSelectBuiltInAssistant,
  onCancel,
}: AgentPickerProps) {
  const { results, isLoading, error, query, setQuery } = useAgentSearch(org);

  // Seed the typed-but-unresolved query once on mount so the user picks up
  // where the smart-resolution attempt left off.
  useEffect(() => {
    if (initialQuery !== undefined && initialQuery !== "") setQuery(initialQuery);
    // Mount-only: re-seeding on every render would fight the user's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The assistant row stays first whatever the query, because it is not a
  // search result: it is the choice of not searching for an agent at all.
  const items = useMemo<PickerItem[]>(() => {
    const agents = results.map(toAgentItem);
    return onSelectBuiltInAssistant ? [BUILT_IN_ASSISTANT_ITEM, ...agents] : agents;
  }, [results, onSelectBuiltInAssistant]);

  const handleSelect = useCallback(
    (item: PickerItem) => {
      if (item.id === BUILT_IN_ASSISTANT_ITEM_ID) {
        onSelectBuiltInAssistant?.();
        return;
      }
      const found = results.find((r) => r.id === item.id);
      if (found !== undefined) onSelect(found);
    },
    [results, onSelect, onSelectBuiltInAssistant],
  );

  return (
    <ResourcePicker
      prompt="Select an agent"
      items={items}
      query={query}
      onQueryChange={setQuery}
      isLoading={isLoading}
      error={error}
      onSelect={handleSelect}
      onCancel={onCancel}
      emptyLabel="no agents found"
    />
  );
}

/** Map a search result to a picker row: org/slug title, description subtitle. */
function toAgentItem(result: SearchResult): PickerItem {
  const title = result.qualifiedSlug !== "" ? result.qualifiedSlug : `${result.org}/${result.slug}`;
  return { id: result.id, title, subtitle: truncate(result.description, SUBTITLE_MAX) };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
