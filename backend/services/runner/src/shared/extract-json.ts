/**
 * Extract JSON from agent text responses.
 *
 * Three-tier extraction with end-first scanning:
 *
 *   Tier 1:    JSON.parse on the full trimmed text.
 *   Tier 1.5:  Code-fence extraction — scan fences last-to-first,
 *              only attempt parse when content starts with { or [.
 *   Tier 1.75: Last-brace extraction — find the last balanced {...}
 *              by scanning backwards from the end of the text.
 *
 * End-first scanning aligns with the prompt injection contract that
 * tells the agent to put JSON as its "final response." When multiple
 * JSON fragments exist (e.g. intermediate debug output followed by
 * the actual result), the last fragment is overwhelmingly the correct
 * one. If the heuristic picks wrong, downstream schema validation
 * catches it and the caller falls through to LLM-based extraction.
 *
 * Trailing-comma repair (stripTrailingCommas) is applied before every
 * JSON.parse attempt across all tiers.
 */

/**
 * Extract JSON from agent text. Returns the parsed value on success,
 * or undefined so the caller can fall through to LLM-based extraction.
 */
export function extractJsonFromText(text: string): unknown | undefined {
  if (!text) return undefined;

  const trimmed = text.trim();

  // Tier 1: full text is valid JSON
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  // Tier 1.5: JSON inside a code fence
  const fenced = extractFromCodeFences(trimmed);
  if (fenced !== undefined) return fenced;

  // Tier 1.75: last balanced {...} in the text
  const braced = extractLastJsonObject(trimmed);
  if (braced !== undefined) return braced;

  return undefined;
}

// ---------------------------------------------------------------------------
// Tier 1.5 — code-fence extraction (last-to-first)
// ---------------------------------------------------------------------------

const CODE_FENCE_RE = /```(?:json|JSON)?\s*\n([\s\S]*?)```/g;

function extractFromCodeFences(text: string): unknown | undefined {
  const fences: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = CODE_FENCE_RE.exec(text)) !== null) {
    fences.push(match[1]);
  }
  CODE_FENCE_RE.lastIndex = 0;

  // Scan last-to-first — the final fence is most likely the structured output
  for (let i = fences.length - 1; i >= 0; i--) {
    const content = fences[i].trim();
    if (!content.startsWith("{") && !content.startsWith("[")) continue;
    const result = tryParse(content);
    if (result !== undefined) return result;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Tier 1.75 — last balanced brace extraction
// ---------------------------------------------------------------------------

function extractLastJsonObject(text: string): unknown | undefined {
  const lastClose = text.lastIndexOf("}");
  if (lastClose === -1) return undefined;

  // Walk backwards from lastClose to find the matching open brace,
  // respecting nesting and string literals.
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = lastClose; i >= 0; i--) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "}") {
      depth++;
    } else if (ch === "{") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(i, lastClose + 1);
        return tryParse(candidate);
      }
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function tryParse(candidate: string): unknown | undefined {
  try {
    return JSON.parse(candidate);
  } catch {
    // fall through
  }

  const repaired = stripTrailingCommas(candidate);
  if (repaired !== candidate) {
    try {
      return JSON.parse(repaired);
    } catch {
      // repair didn't help
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
