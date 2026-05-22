/**
 * Error message enrichment for agent resilience.
 *
 * Two exports:
 * 1. enrichErrorMessage() — pure utility that pattern-matches tool errors
 *    to actionable recovery hints.
 * 2. createErrorHintsMiddleware() — wrapToolCall middleware that catches
 *    tool execution errors and enriches the ToolMessage with hints.
 *
 * Zero external dependencies beyond LangChain messages.
 */

import { ToolMessage } from "@langchain/core/messages";
import type { StigmerMiddleware } from "./types.js";

/**
 * Enrich an error message with contextual recovery hints.
 *
 * Analyzes the error string and tool name to produce actionable
 * suggestions that help the LLM try alternative approaches.
 */
export function enrichErrorMessage(toolName: string, error: string): string {
  const hints: string[] = [];
  const errorLower = error.toLowerCase();
  const toolLower = toolName.toLowerCase();

  if (errorLower.includes("not found") || errorLower.includes("no such file")) {
    hints.push("Try using ls or glob to discover available files/resources");
    hints.push("Check if the path is correct — use ls on the parent directory");
    hints.push("The file might be in a different location — search with glob patterns");
  }

  if (errorLower.includes("permission") || errorLower.includes("access denied")) {
    hints.push("Check if the path is correct and accessible");
    hints.push("Verify you have the right permissions for this operation");
    hints.push("Try an alternative location if the target is read-only");
  }

  if (errorLower.includes("text to replace not found")) {
    hints.push("Re-read the file with the read tool to see its current contents");
    hints.push("The file content may have changed — use the actual text from read output");
    hints.push("Check for whitespace differences (tabs vs spaces, trailing newlines)");
    hints.push("If the exact text cannot be matched, use write to replace the entire file");
  }

  if (toolLower.includes("edit") || toolLower.includes("write")) {
    hints.push("Try reading the target first to understand its current state");
    hints.push("If editing fails, try read + modify + write as a complete replacement");
  }

  if (errorLower.includes("auth") || errorLower.includes("unauthorized") || errorLower.includes("403")) {
    hints.push("Verify authentication credentials are correct");
    hints.push("Check if the token has expired or lacks required permissions");
  }

  if (errorLower.includes("connection") || errorLower.includes("timeout") || errorLower.includes("unavailable")) {
    hints.push("This may be a transient error — wait a moment and retry");
    hints.push("Check if the service is available");
  }

  if (errorLower.includes("invalid") || errorLower.includes("malformed") || errorLower.includes("format")) {
    hints.push("Review the parameter format and types");
    hints.push("Try with simplified or default parameters first");
  }

  if (errorLower.includes("rpc error") || errorLower.includes("grpc")) {
    if (errorLower.includes("not found") || errorLower.includes("notfound")) {
      hints.push("The requested resource does not exist on the platform yet");
      hints.push("Use a list or search tool to discover existing resources");
    }
    if (errorLower.includes("permission denied") || errorLower.includes("permissiondenied")) {
      hints.push("The API key or credentials lack permission for this operation");
    }
    if (errorLower.includes("unavailable")) {
      hints.push("The backend service is temporarily unreachable — wait and retry");
    }
  }

  if (
    errorLower.includes("not found") &&
    (errorLower.includes("org") || errorLower.includes("slug") ||
     errorLower.includes("server") || errorLower.includes("environment"))
  ) {
    hints.push("Verify the org and slug/name values are correct");
    hints.push("The resource may not have been created yet");
    hints.push("Use a list operation to see what exists in the current org/environment");
  }

  if (errorLower.includes("rate") || errorLower.includes("limit") ||
      errorLower.includes("quota") || errorLower.includes("429")) {
    hints.push("Wait a moment before retrying — rate limits reset over time");
    hints.push("Try reducing the scope of your request");
  }

  if (hints.length > 0) {
    const recovery = hints.map(h => `- ${h}`).join("\n");
    return `Error: ${error}\n\nRecovery suggestions:\n${recovery}`;
  }

  return (
    `Error: ${error}\n\n` +
    "Recovery suggestions:\n" +
    "- Analyze the error message for clues about what went wrong\n" +
    "- Try a different approach or alternative tool\n" +
    "- Verify your inputs and assumptions are correct"
  );
}

/**
 * Create middleware that enriches tool execution errors with recovery hints.
 *
 * Wraps every tool call in a try/catch. On error, produces a ToolMessage
 * with the enriched error text instead of letting the error propagate
 * as a raw string.
 */
export function createErrorHintsMiddleware(): StigmerMiddleware {
  return {
    name: "ErrorHintsMiddleware",

    async wrapToolCall(request, handler) {
      try {
        return await handler(request);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const toolName = request.toolCall.name;
        const enriched = enrichErrorMessage(toolName, errorMessage);

        return new ToolMessage({
          content: enriched,
          tool_call_id: request.toolCall.id,
          name: toolName,
        });
      }
    },
  };
}
