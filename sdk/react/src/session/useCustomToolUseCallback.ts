"use client";

// Tells the host once about each call of its own tools that waits for its
// answer, for a host that answers in its own panel rather than a card: the
// viewer's `onCustomToolUse`. Once per call for each mounted viewer, so a
// reopened conversation tells the host again about a call still waiting;
// an answered call is never in the list, so a replay never tells it.

import { useEffect, useRef } from "react";
import type { ToolUse } from "@stigmer/client";
import type { CustomToolAnswer, ToolCallInfo } from "../run/tool-cards-context.js";
import { toolCallInfoOf } from "../run/tool-card.js";

/**
 * The host hears a call of its own tools that waits for its answer: `call`
 * is the same view a tool card gets, and `answer` answers it.
 */
export type OnCustomToolUse = (call: ToolCallInfo, answer: CustomToolAnswer) => void;

/**
 * @internal Calls `onCustomToolUse` once for each call in `calls` (the live
 * turn's calls waiting on the app), for a viewer that may answer; never for
 * one that may not, so `answer` always works. A handler that throws, or
 * returns a promise that rejects, is reported once and not called again for
 * that call; the thread goes on.
 */
export function useCustomToolUseCallback(options: {
  readonly calls: readonly ToolUse[];
  readonly sessionId: string;
  readonly answerFor: ((customToolUseId: string) => CustomToolAnswer) | undefined;
  readonly onCustomToolUse: OnCustomToolUse | undefined;
}): void {
  const { calls, sessionId, answerFor } = options;
  // The latest handler, read at each call: a host that renders a new
  // function each time is told once, not again on every render.
  const handlerRef = useRef(options.onCustomToolUse);
  handlerRef.current = options.onCustomToolUse;
  // The calls this viewer told the host about, marked before the call so a
  // re-render while the handler runs never tells it twice.
  const told = useRef(new Set<string>());
  const hasHandler = options.onCustomToolUse !== undefined;

  useEffect(() => {
    if (!hasHandler || answerFor === undefined) return;
    for (const tool of calls) {
      if (told.current.has(tool.id)) continue;
      told.current.add(tool.id);
      const handler = handlerRef.current;
      if (handler === undefined) return;
      const call = toolCallInfoOf(tool, sessionId);
      try {
        const returned: unknown = handler(call, answerFor(tool.id));
        if (isThenable(returned)) returned.then(undefined, (error: unknown) => report(call, error));
      } catch (error) {
        report(call, error);
      }
    }
  }, [calls, sessionId, answerFor, hasHandler]);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function report(call: ToolCallInfo, error: unknown): void {
  console.error(`Stigmer: onCustomToolUse threw for ${call.tool} (${call.id}); the call still waits for the app's answer.`, error);
}
