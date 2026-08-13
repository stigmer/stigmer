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
  extractShellIntent,
  defaultChromeForCategory,
  defaultDisclosureForCategory,
  isRunGroupableCategory,
} from "./tool-categories.js";
import type { ToolCategory, ToolChrome, ToolDisclosure } from "./tool-categories.js";
import { summarizeResultView } from "./ResultView.js";

/** Optional per-kind overrides for label, summary, disclosure, and run-grouping. */
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
  /**
   * Overrides the default chrome tier — quiet unboxed line vs bordered card
   * (see {@link ToolChrome}). Use to restore the boxed look for a kind
   * (`() => "card"`) or to quiet a chatty custom tool (`() => "quiet"`).
   * A pending approval gate or a failure always escalates the row to a card
   * regardless of this override — a decision surface and error output must
   * never render frameless.
   */
  readonly chrome?: (toolCall: ToolCall, result: ToolResultView) => ToolChrome;
  /**
   * Overrides whether consecutive same-kind calls fold into one collapsible
   * "Read 5 files" chip. Use to fold a chatty custom tool (`() => true`) or to
   * keep a normally-folded category as standalone rows (`() => false`) without
   * forking the thread layout. Defaults to {@link isRunGroupableCategory}.
   */
  readonly runGroupable?: (toolCall: ToolCall) => boolean;
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

/**
 * Resolves whether a tool call participates in run-grouping, honouring a
 * registered {@link ToolPresenter.runGroupable} override before the
 * category default ({@link isRunGroupableCategory}).
 *
 * This is the non-hook twin of the `runGroupable` field in
 * {@link useToolPresentation}, so the pure `segmentToolCalls` layout pass and
 * the component layer share one source of truth (and honour the same override).
 */
export function resolveRunGroupable(toolCall: ToolCall): boolean {
  const kind = resolveToolKind(toolCall);
  const override = registry.get(kind)?.runGroupable;
  if (override) return override(toolCall);
  return isRunGroupableCategory(resolveToolCategoryFromCall(toolCall).category);
}

/** The fully-resolved presentation for a tool call, returned by {@link useToolPresentation}. */
export interface ToolPresentation {
  /** Harness-agnostic kind (wire field, with name fallback). */
  readonly kind: ToolKind;
  /** Presentation category (1:1 with kind). */
  readonly category: ToolCategory;
  /** Display label, e.g. "Edit", "Shell". */
  readonly label: string;
  /**
   * The model-authored intent phrase for a SHELL call (stigmer#276), or null
   * when absent (legacy executions, skipped optional arg, non-shell kinds).
   * Raw extraction — precedence against overrides is resolved in
   * {@link ToolPresentation.title}.
   */
  readonly intent: string | null;
  /**
   * The row title: a registered presenter's `label` override wins (a host's
   * explicit wording is never displaced by model output), then the
   * model-authored {@link intent}, then the category {@link label}. Renderers
   * that title a row use this; {@link label} stays the short kind label for
   * chips and badges.
   */
  readonly title: string;
  /** Primary argument (path, command, pattern...), or null. */
  readonly primaryArg: string | null;
  /** Normalized result view for rendering with {@link ResultView}. */
  readonly result: ToolResultView;
  /** One-line result summary suffix for the collapsed row (e.g. "+40 -0"). */
  readonly resultSummary: string | null;
  /**
   * Default inline disclosure for this tool — `"preview"` keeps a bounded,
   * persistent preview of the result, `"summary"` keeps a compact row. The
   * active/awaiting state can still force a row open; this is the *settled*
   * default.
   */
  readonly disclosure: ToolDisclosure;
  /**
   * Default chrome tier for this tool — `"quiet"` renders an unboxed line,
   * `"card"` a bordered card (see {@link ToolChrome}). A pending gate or a
   * failure escalates to `"card"` in the component layer; this is the
   * *settled* default.
   */
  readonly chrome: ToolChrome;
  /**
   * Whether consecutive same-kind calls fold into one collapsible chip — the
   * run-grouping axis, orthogonal to {@link disclosure}. See
   * {@link isRunGroupableCategory}.
   */
  readonly runGroupable: boolean;
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

    const overrideLabel = override?.label?.(toolCall);
    const label = overrideLabel ?? categoryInfo.label;
    const intent = extractShellIntent(toolCall);
    const title = overrideLabel ?? intent ?? categoryInfo.label;
    const resultSummary =
      override?.summary?.(toolCall, result) ?? summarizeResultView(result);
    const disclosure =
      override?.disclosure?.(toolCall, result) ??
      defaultDisclosureForCategory(categoryInfo.category);
    const chrome =
      override?.chrome?.(toolCall, result) ??
      defaultChromeForCategory(categoryInfo.category);
    const runGroupable =
      override?.runGroupable?.(toolCall) ??
      isRunGroupableCategory(categoryInfo.category);

    return {
      kind,
      category: categoryInfo.category,
      label,
      intent,
      title,
      primaryArg: extractPrimaryArg(toolCall),
      result,
      resultSummary,
      disclosure,
      chrome,
      runGroupable,
    };
  }, [toolCall]);
}
