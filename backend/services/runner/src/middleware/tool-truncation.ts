/**
 * Tool result truncation middleware.
 *
 * Prevents any single tool result from consuming an excessive share of
 * the LLM's context window. Applied uniformly to ALL tools via
 * wrapToolCall. When a ToolMessage result exceeds maxChars, the content
 * is prefix-truncated and a marker is appended telling the LLM to
 * request specific sections.
 *
 * Default limit: 30,000 characters (~7,500 tokens).
 */

import { ToolMessage } from "@langchain/core/messages";
import type {
  StigmerMiddleware,
  ToolCallRequest,
  ToolTruncationConfig,
} from "./types.js";

const DEFAULT_MAX_CHARS = 30_000;

export function createToolTruncationMiddleware(
  config: Partial<ToolTruncationConfig> = {},
): StigmerMiddleware & { readonly truncationCount: number; readonly totalCharsTruncated: number } {
  const maxChars = config.maxChars ?? DEFAULT_MAX_CHARS;
  if (maxChars <= 0) {
    throw new Error(`maxChars must be positive, got ${maxChars}`);
  }

  let truncationCount = 0;
  let totalCharsTruncated = 0;

  function buildMarker(originalChars: number): string {
    return (
      `\n\n[truncated — result was ${originalChars.toLocaleString()} chars, ` +
      `exceeded ${maxChars.toLocaleString()} char limit. ` +
      `Ask for specific sections or narrow your query.]`
    );
  }

  const middleware: StigmerMiddleware & { readonly truncationCount: number; readonly totalCharsTruncated: number } = {
    name: "ToolTruncationMiddleware",

    get truncationCount() { return truncationCount; },
    get totalCharsTruncated() { return totalCharsTruncated; },

    beforeAgent() {
      truncationCount = 0;
      totalCharsTruncated = 0;
    },

    async wrapToolCall(request, handler) {
      const result = await handler(request);

      if (!(result instanceof ToolMessage)) return result;

      const content = result.content;
      if (typeof content !== "string") return result;
      if (content.length <= maxChars) return result;

      const originalChars = content.length;
      const charsTruncated = originalChars - maxChars;
      const truncatedContent = content.slice(0, maxChars) + buildMarker(originalChars);

      truncationCount++;
      totalCharsTruncated += charsTruncated;

      const toolName = request.toolCall.name;
      console.warn(
        `[TRUNCATED] tool=${toolName} original_chars=${originalChars} ` +
        `limit=${maxChars} chars_truncated=${charsTruncated}`,
      );

      config.onTruncation?.(toolName, charsTruncated);

      return new ToolMessage({
        content: truncatedContent,
        tool_call_id: request.toolCall.id,
        name: toolName,
      });
    },

    afterAgent() {
      if (truncationCount > 0) {
        console.log(
          `[ToolTruncation] Summary: ${truncationCount} results truncated, ` +
          `${totalCharsTruncated} total chars removed (limit=${maxChars})`,
        );
      }
    },
  };

  return middleware;
}
