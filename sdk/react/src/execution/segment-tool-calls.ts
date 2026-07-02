import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { resolveToolCategoryFromCall } from "./tool-categories";
import type { ToolCategory } from "./tool-categories";
import { resolveRunGroupable } from "./tool-presenter";

/**
 * Minimum number of consecutive same-category groupable calls before they fold
 * into a chip. A lone groupable call (e.g. a single `Read foo.ts`) reads better
 * as its own row than as a one-item "Read 1 file" chip, so grouping only kicks
 * in at two or more.
 */
const MIN_RUN_LENGTH = 2;

/**
 * One renderable unit of a turn's tool activity.
 *
 * - `row` — a single tool call rendered as a persistent timeline row.
 * - `run` — a maximal run of >= {@link MIN_RUN_LENGTH} consecutive low-signal
 *   same-category calls (e.g. reads), folded into one collapsible chip.
 */
export type ToolSegment =
  | { readonly kind: "row"; readonly toolCall: ToolCall; readonly key: string }
  | {
      readonly kind: "run";
      readonly category: ToolCategory;
      readonly toolCalls: readonly ToolCall[];
      readonly key: string;
    };

/** Stable key for a single tool-call row (mirrors the prior group keying). */
function rowKey(toolCall: ToolCall): string {
  return toolCall.id || toolCall.name;
}

/**
 * Partitions a turn's tool calls into a chronological sequence of {@link
 * ToolSegment}s: maximal runs of consecutive low-signal same-category calls
 * (read / list / search) fold into one `run` chip, while every other call —
 * and any groupable call that has no same-kind neighbour — stays a persistent
 * `row`.
 *
 * This is the layout pass behind the "persistent-row timeline": instead of
 * hiding a whole turn behind one collapse, only repetitive noise is compressed,
 * and high-signal rows (edits, shell, MCP, sub-agents) always remain visible.
 * Chronology is preserved — a run never reorders calls, and an interleaving of
 * categories (read, search, read) yields three separate segments, not one.
 *
 * Pure and dependency-light so it can be unit-tested exhaustively and memoized
 * by the caller; groupability is resolved through {@link resolveRunGroupable},
 * so a consumer's registry override is honoured here exactly as in the
 * component layer.
 *
 * @example
 * ```ts
 * // read, read, read, edit  ->  [run(read x3), row(edit)]
 * // read, search, read      ->  [row(read), row(search), row(read)]
 * const segments = segmentToolCalls(message.toolCalls);
 * ```
 */
export function segmentToolCalls(
  toolCalls: readonly ToolCall[],
): ToolSegment[] {
  const segments: ToolSegment[] = [];

  // Resolve category + groupability once per call so the scan below is a cheap
  // index walk rather than repeated kind resolution.
  const categories = toolCalls.map(
    (tc) => resolveToolCategoryFromCall(tc).category,
  );
  const groupable = toolCalls.map((tc) => resolveRunGroupable(tc));

  let i = 0;
  while (i < toolCalls.length) {
    const category = categories[i];

    if (groupable[i]) {
      // Extend the run while the next call is the same groupable category.
      let j = i + 1;
      while (j < toolCalls.length && groupable[j] && categories[j] === category) {
        j++;
      }

      if (j - i >= MIN_RUN_LENGTH) {
        const run = toolCalls.slice(i, j);
        segments.push({
          kind: "run",
          category,
          toolCalls: run,
          key: `run-${category}-${rowKey(run[0])}`,
        });
        i = j;
        continue;
      }
    }

    segments.push({ kind: "row", toolCall: toolCalls[i], key: rowKey(toolCalls[i]) });
    i++;
  }

  return segments;
}
