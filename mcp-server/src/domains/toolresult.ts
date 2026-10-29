// Helpers for shaping MCP tool return values.
//
// Every tool returns its payload as a single text content block, and a failed
// call surfaces as an `isError` result carrying the user-facing message, built
// here so every domain handler stays a one-liner.

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Wrap a plain text payload into the CallToolResult structure tools return. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/** Wrap a failure into an `isError` CallToolResult carrying its message. */
export function errorResult(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Run a string-producing tool body, returning its output as a text result or,
 * if it throws, as an `isError` result. Domain handlers compose this so the
 * try/catch lives in exactly one place.
 */
export async function textOrError(produce: () => Promise<string>): Promise<CallToolResult> {
  try {
    return textResult(await produce());
  } catch (err) {
    return errorResult(err);
  }
}
