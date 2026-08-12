/**
 * Unicode-flag regex sanitization for MCP tool input schemas (issue #420).
 *
 * Why this exists: real-world MCP servers ship JSON-schema `pattern` values
 * that are legal as plain ECMAScript regexes but invalid under the unicode
 * flag (PayPal's `^https\:\/\/` — `\:` is an invalid escape under /u).
 * @langchain/core validates tool input on EVERY call with
 * @cfworker/json-schema, which compiles patterns via `new RegExp(p, "u")`
 * at exactly two uncaught sites: the `pattern` keyword and each
 * `patternProperties` key. One bad vendor pattern therefore makes the tool
 * permanently uncallable on the deep-agent path — every invocation dies
 * with a cryptic SyntaxError before the tool is ever reached. (The third
 * /u compile site, `format: "regex"`, validates instance values inside a
 * try/catch and fails gracefully — not a crash surface.)
 *
 * The fix: at the deep-agent connect funnel (mcp-manager.ts
 * connectMcpServers), drop every pattern that cannot compile under /u.
 * Dropping is deliberate — rewriting to a /u-safe equivalent would need an
 * Annex-B-aware regex transpiler, disproportionate machinery for what is
 * best-effort client-side validation; the MCP server still validates its
 * own inputs server-side. This mirrors the loosening posture of
 * @langchain/mcp-adapters' own schema pipeline (dereferenceJsonSchema →
 * simplifyJsonSchemaForLLM), which already normalizes schemas for this
 * exact validator.
 *
 * THE INVARIANT: sanitization may only ever LOOSEN validation, never
 * tighten it. Dropping a `patternProperties` entry naively would violate
 * this — @cfworker marks pattern-matched keys as "evaluated" and routes
 * unevaluated keys into the `additionalProperties` / `unevaluatedProperties`
 * checks, so under `additionalProperties: false` the drop would flip a
 * crash into a false REJECTION of valid inputs. Whenever a
 * `patternProperties` entry is dropped, any restrictive
 * `additionalProperties` / `unevaluatedProperties` at that schema level is
 * therefore relaxed too.
 *
 * Scope: this sanitizer serves the EXECUTION path only. Discovery
 * (activities/discover-mcp-server.ts) persists tool schemas verbatim from
 * listTools — deliberately: the stored schema is the vendor's truth for
 * display, and discovery never invokes tools, so it cannot hit the crash.
 * Do not "extend" sanitization there.
 */

/** One dropped regex constraint, for the caller's log line. */
export interface DroppedPattern {
  /** JSON-pointer-style path of the dropped constraint within the schema. */
  location: string;
  /** The pattern source that failed to compile under the unicode flag. */
  pattern: string;
  /**
   * True when the pattern compiles WITHOUT the /u flag — vendor sloppiness
   * (Annex B legacy syntax), the oss#420 class. False means the regex is
   * broken outright; either way validation could only crash, so both drop.
   */
  compilesWithoutUnicodeFlag: boolean;
}

/** Keywords whose value is a single subschema. */
const SINGLE_SCHEMA_KEYWORDS = [
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "items",
  "additionalItems",
  "unevaluatedItems",
  "contains",
  "not",
  "if",
  "then",
  "else",
] as const;

/** Keywords whose value is an array of subschemas. */
const SCHEMA_ARRAY_KEYWORDS = ["anyOf", "allOf", "oneOf", "prefixItems"] as const;

/** Keywords whose value is an object mapping names to subschemas. */
const SCHEMA_MAP_KEYWORDS = [
  "properties",
  "patternProperties",
  "dependentSchemas",
  "$defs",
  "definitions",
] as const;

function compilesUnderUnicodeFlag(pattern: string): boolean {
  try {
    new RegExp(pattern, "u");
    return true;
  } catch {
    return false;
  }
}

function compilesWithoutUnicodeFlag(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON-pointer token escaping (RFC 6901): `~` → `~0`, `/` → `~1`. */
function pointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Drop unicode-invalid regex patterns from a JSON schema, in place.
 *
 * Walks only schema positions (the recursion set is @cfworker's own
 * validated-keyword list), so a property literally NAMED "pattern" under
 * `properties` is never touched. The walker handles composition keywords
 * (anyOf/allOf/oneOf/not/if-then-else) even though the adapter's
 * simplifyJsonSchemaForLLM currently strips them, and carries a visited-set
 * cycle guard even though the adapter's $ref inlining currently guarantees
 * an acyclic result — correctness here must not depend on another
 * package's internals holding across dependency bumps.
 *
 * Returns the dropped constraints (empty for clean schemas — the common
 * case, which this walk leaves byte-identical).
 */
export function sanitizeSchemaPatterns(schema: unknown): DroppedPattern[] {
  const dropped: DroppedPattern[] = [];
  if (!isPlainObject(schema)) return dropped;
  walkSchema(schema, "", dropped, new Set());
  return dropped;
}

function recordDrop(dropped: DroppedPattern[], location: string, pattern: string): void {
  dropped.push({
    location,
    pattern,
    compilesWithoutUnicodeFlag: compilesWithoutUnicodeFlag(pattern),
  });
}

function walkSchema(
  node: Record<string, unknown>,
  path: string,
  dropped: DroppedPattern[],
  seen: Set<object>,
): void {
  if (seen.has(node)) return;
  seen.add(node);

  if (typeof node.pattern === "string" && !compilesUnderUnicodeFlag(node.pattern)) {
    recordDrop(dropped, `${path}/pattern`, node.pattern);
    delete node.pattern;
  }

  if (isPlainObject(node.patternProperties)) {
    const patternProperties = node.patternProperties;
    let droppedEntry = false;
    for (const key of Object.keys(patternProperties)) {
      if (compilesUnderUnicodeFlag(key)) continue;
      recordDrop(dropped, `${path}/patternProperties/${pointerToken(key)}`, key);
      delete patternProperties[key];
      droppedEntry = true;
    }
    if (droppedEntry) {
      // Never-tighten: keys the dropped pattern used to match would now
      // fall through to these checks and could be falsely rejected.
      if (node.additionalProperties !== undefined && node.additionalProperties !== true) {
        delete node.additionalProperties;
      }
      if (node.unevaluatedProperties !== undefined && node.unevaluatedProperties !== true) {
        delete node.unevaluatedProperties;
      }
      if (Object.keys(patternProperties).length === 0) {
        delete node.patternProperties;
      }
    }
  }

  for (const keyword of SINGLE_SCHEMA_KEYWORDS) {
    const value = node[keyword];
    if (isPlainObject(value)) {
      walkSchema(value, `${path}/${keyword}`, dropped, seen);
    }
  }

  for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
    const value = node[keyword];
    if (!Array.isArray(value)) continue;
    value.forEach((entry, index) => {
      if (isPlainObject(entry)) {
        walkSchema(entry, `${path}/${keyword}/${index}`, dropped, seen);
      }
    });
  }

  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    const value = node[keyword];
    if (!isPlainObject(value)) continue;
    for (const [name, entry] of Object.entries(value)) {
      if (isPlainObject(entry)) {
        walkSchema(entry, `${path}/${keyword}/${pointerToken(name)}`, dropped, seen);
      }
    }
  }

  // Draft-07 `items` tuple form and `dependencies` schema form — both
  // keywords are dual-shaped, so the typed loops above miss these arms.
  if (Array.isArray(node.items)) {
    node.items.forEach((entry, index) => {
      if (isPlainObject(entry)) {
        walkSchema(entry, `${path}/items/${index}`, dropped, seen);
      }
    });
  }
  if (isPlainObject(node.dependencies)) {
    for (const [name, entry] of Object.entries(node.dependencies)) {
      // Array-valued entries are dependentRequired (property names, not
      // schemas) — only schema-valued entries are walked.
      if (isPlainObject(entry)) {
        walkSchema(entry, `${path}/dependencies/${pointerToken(name)}`, dropped, seen);
      }
    }
  }
}
