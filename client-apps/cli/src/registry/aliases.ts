// Algorithmic alias generation — a faithful port of the Go types.GenerateAliases
// family. Aliases are *derived* from proto kind metadata (name/display_name/
// id_prefix), never hardcoded, so a new resource kind picks up its full set of
// accepted spellings automatically. Keeping the algorithm byte-for-byte
// identical to Go guarantees both CLIs accept exactly the same inputs.

/**
 * Generate every accepted input form for a resource kind.
 *
 * From name "McpServer":      "mcpserver", "mcp-server", "mcp_server", "McpServer"
 * From displayName "MCP Server": "mcp" / "MCP"
 * From idPrefix "mcp":         "mcp"
 * Plus the plural of every form above.
 */
export function generateAliases(name: string, displayName: string, idPrefix: string): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];

  const add = (alias: string): void => {
    if (alias === "") return;
    const lower = alias.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      aliases.push(alias);
    }
  };

  // From name: "McpServer"
  add(name.toLowerCase()); // "mcpserver"
  add(toKebabCase(name)); // "mcp-server"
  add(toSnakeCase(name)); // "mcp_server"
  add(name); // "McpServer"

  // From display_name: single-word names contribute lower/upper forms; for
  // multi-word names only the first word is added, and only when it does not
  // simply re-derive the name (this stops "Agent Instance" from stealing
  // "agent" from "Agent", while still letting "MCP Server" register "mcp").
  const words = displayName.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 1) {
    add(words[0].toLowerCase());
    add(words[0].toUpperCase());
  } else if (words.length > 1) {
    const firstWord = words[0].toLowerCase();
    const lowerName = name.toLowerCase();
    if (!lowerName.startsWith(firstWord) || firstWord === lowerName) {
      add(firstWord);
      add(words[0].toUpperCase());
    }
  }

  // From id_prefix: "mcp"
  add(idPrefix);

  // Plurals of every form gathered so far.
  for (const alias of [...aliases]) {
    add(pluralize(alias));
  }

  return aliases;
}

/** Convert PascalCase to kebab-case: "McpServer" -> "mcp-server". */
export function toKebabCase(s: string): string {
  return splitCase(s, "-");
}

/** Convert PascalCase to snake_case: "McpServer" -> "mcp_server". */
export function toSnakeCase(s: string): string {
  return splitCase(s, "_");
}

function splitCase(s: string, sep: string): string {
  let result = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (i > 0 && ch >= "A" && ch <= "Z") {
      result += sep;
    }
    result += ch.toLowerCase();
  }
  return result;
}

/** Naive English pluralization; the singular is always accepted too. */
export function pluralize(s: string): string {
  if (s === "" || s.endsWith("s")) return s;
  return `${s}s`;
}

/** Normalize user input for case-insensitive alias lookup. */
export function normalizeAlias(input: string): string {
  return input.trim().toLowerCase();
}
