/**
 * Extract JSON from agent text responses.
 *
 * Agents frequently wrap JSON in prose and markdown code fences.
 * This module provides a robust extraction pipeline that tries
 * multiple strategies before giving up.
 *
 * Extraction order:
 * 1. Direct JSON.parse on the full text
 * 2. Extract from markdown code fences (```json ... ``` or ``` ... ```)
 * 3. Heuristic: find outermost { ... } or [ ... ] pair and parse
 */

const CODE_FENCE_PATTERN = /```(?:\w*)\s*\n([\s\S]*?)\n\s*```/g;

/**
 * Attempt to extract a JSON object from free-text agent output.
 * Returns the parsed object on success, or undefined if no valid
 * JSON can be extracted.
 */
export function extractJsonFromText(text: string): unknown | undefined {
  if (!text) return undefined;

  // Tier 1: direct JSON.parse on the full text
  try {
    return JSON.parse(text);
  } catch {
    // Not pure JSON — continue to code-fence extraction
  }

  // Tier 1.5: extract from markdown code fences
  const fenceResult = extractFromCodeFences(text);
  if (fenceResult !== undefined) return fenceResult;

  // Tier 1.75: heuristic brace/bracket extraction
  return extractFromBraces(text);
}

function extractFromCodeFences(text: string): unknown | undefined {
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  CODE_FENCE_PATTERN.lastIndex = 0;
  while ((match = CODE_FENCE_PATTERN.exec(text)) !== null) {
    matches.push(match[1].trim());
  }

  for (const candidate of matches) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Not valid JSON in this fence — try next
    }
  }

  return undefined;
}

function extractFromBraces(text: string): unknown | undefined {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      // Braces didn't contain valid JSON
    }
  }

  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(text.slice(firstBracket, lastBracket + 1));
    } catch {
      // Brackets didn't contain valid JSON
    }
  }

  return undefined;
}
