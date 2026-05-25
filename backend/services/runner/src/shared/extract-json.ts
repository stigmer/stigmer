/**
 * Extract JSON from agent text responses.
 *
 * Only attempts direct JSON.parse on the full trimmed text. If the
 * response is not a complete, valid JSON value, returns undefined so
 * the caller can fall through to LLM-based extraction which provides
 * schema-guaranteed output via tool-calling.
 *
 * Heuristic approaches (code-fence scanning, brace matching) were
 * removed because they produce silent wrong data when the response
 * contains multiple JSON fragments — a common scenario with markdown
 * reports, debug output, or multi-step agent responses.
 */

/**
 * Attempt to parse the full text as a JSON value.
 * Returns the parsed object on success, or undefined if the text
 * is not valid JSON.
 *
 * Handles trailing commas (a common LLM output quirk) by stripping
 * them before parsing. This is a well-defined transformation, not a
 * heuristic guess.
 */
export function extractJsonFromText(text: string): unknown | undefined {
  if (!text) return undefined;

  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to trailing-comma repair
  }

  const repaired = stripTrailingCommas(trimmed);
  if (repaired !== trimmed) {
    try {
      return JSON.parse(repaired);
    } catch {
      // Trailing-comma repair didn't fix it
    }
  }

  return undefined;
}

/**
 * Remove trailing commas before } and ] — a common LLM quirk that
 * produces invalid JSON. Only removes commas that are followed by
 * optional whitespace and a closing delimiter.
 */
function stripTrailingCommas(json: string): string {
  return json.replace(/,\s*([}\]])/g, "$1");
}
