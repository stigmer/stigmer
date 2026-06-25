"use client";

// Headless presentation layer for tool calls.
//
// useToolPresentation turns a ToolCall into everything a renderer needs — kind,
// label, primary argument, a normalized result view, and a one-line summary —
// without rendering anything. Styled components (ToolCallItem, ToolCallDetail)
// consume it; platform builders can consume it to build their own tool UI.
//
// The registry lets a consumer override the label or summary for a ToolKind
// (e.g. a product that wants "Run command" instead of "Shell") without forking
// the components. Result interpretation stays in @stigmer/sdk; this is the React
// presentation seam.

import { useMemo } from "react";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolKind, resolveToolKind, normalizeToolResult } from "@stigmer/sdk";
import type { ToolResultView } from "@stigmer/sdk";
import {
  resolveToolCategoryFromCall,
  extractPrimaryArg,
  defaultDisclosureForCategory,
} from "./tool-categories";
import type { ToolCategory, ToolDisclosure } from "./tool-categories";
import { summarizeResultView } from "./ResultView";

/** Optional per-kind overrides for label, summary, and disclosure. */
export interface ToolPresenter {
  /** Overrides the display label (e.g. "Shell" -> "Run command"). */
  readonly label?: (toolCall: ToolCall) => string;
  /** Overrides the one-line result summary suffix. */
  readonly summary?: (toolCall: ToolCall, result: ToolResultView) => string | null;
  /**
   * Overrides the default inline disclosure. Use to keep a noisy MCP tool
   * compact (`() => "summary"`) or to foreground a custom tool's output
   * (`() => "preview"`) without forking the components.
   */
  readonly disclosure?: (toolCall: ToolCall, result: ToolResultView) => ToolDisclosure;
}

const registry = new Map<ToolKind, ToolPresenter>();

/**
 * Registers a custom presenter for a {@link ToolKind}, overriding the default
 * label and/or summary. Call once at app startup. This is the extension point
 * for platform builders embedding the execution UI who want product-specific
 * wording without forking the components.
 *
 * Returns a disposer that unregisters the presenter, restoring the previous one
 * for that kind (or the default). Most apps register once at startup and ignore
 * it; tests and dynamic hosts use it to avoid leaking global state.
 *
 * @example
 * ```ts
 * import { registerToolPresenter, ToolKind } from "@stigmer/react";
 *
 * const dispose = registerToolPresenter(ToolKind.SHELL, {
 *   label: () => "Run command",
 *   summary: (_tc, result) =>
 *     result.type === "terminal" && result.exitCode ? `failed (${result.exitCode})` : null,
 * });
 * // later: dispose();
 * ```
 */
export function registerToolPresenter(
  kind: ToolKind,
  presenter: ToolPresenter,
): () => void {
  const previous = registry.get(kind);
  registry.set(kind, presenter);
  return () => {
    if (previous === undefined) {
      registry.delete(kind);
    } else {
      registry.set(kind, previous);
    }
  };
}

/** Returns the registered presenter for a kind, if any. */
export function getToolPresenter(kind: ToolKind): ToolPresenter | undefined {
  return registry.get(kind);
}

/** The fully-resolved presentation for a tool call, returned by {@link useToolPresentation}. */
export interface ToolPresentation {
  /** Harness-agnostic kind (wire field, with name fallback). */
  readonly kind: ToolKind;
  /** Presentation category (1:1 with kind). */
  readonly category: ToolCategory;
  /** Display label, e.g. "Edit", "Shell". */
  readonly label: string;
  /** Primary argument (path, command, pattern...), or null. */
  readonly primaryArg: string | null;
  /** Normalized result view for rendering with {@link ResultView}. */
  readonly result: ToolResultView;
  /** One-line result summary suffix for the collapsed row (e.g. "+40 -0"). */
  readonly resultSummary: string | null;
  /**
   * Default inline disclosure for this tool — `"preview"` foregrounds the
   * result, `"summary"` keeps a compact row. The active/awaiting state can
   * still force a row open; this is the *settled* default.
   */
  readonly disclosure: ToolDisclosure;
}

/**
 * Resolves the complete, render-ready presentation for a tool call.
 *
 * Headless and memoized: the returned object is referentially stable across
 * renders for the same `toolCall`, so it is safe to depend on in `React.memo`
 * leaves of the streaming thread.
 */
export function useToolPresentation(toolCall: ToolCall): ToolPresentation {
  return useMemo(() => {
    const kind = resolveToolKind(toolCall);
    const categoryInfo = resolveToolCategoryFromCall(toolCall);
    const result = normalizeToolResult(toolCall);
    const override = registry.get(kind);

    const label = override?.label?.(toolCall) ?? categoryInfo.label;
    const resultSummary =
      override?.summary?.(toolCall, result) ?? summarizeResultView(result);
    const disclosure =
      override?.disclosure?.(toolCall, result) ??
      defaultDisclosureForCategory(categoryInfo.category);

    return {
      kind,
      category: categoryInfo.category,
      label,
      primaryArg: extractPrimaryArg(toolCall),
      result,
      resultSummary,
      disclosure,
    };
  }, [toolCall]);
}
