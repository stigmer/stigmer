// Algorithmic alias generation. Aliases are *derived* from proto kind metadata
// (name/display_name/id_prefix/proto enum name), never hardcoded, so a new
// resource kind picks up its full set of accepted spellings automatically.

/**
 * Generate every accepted input form for a resource kind.
 *
 * From name "ChannelApp":     "channelapp", "channel-app", "channel_app", "ChannelApp"
 * From displayName "Channel App": nothing here ("channel" is the name's own prefix);
 *                              a single-word display name adds its lower/upper forms
 * From idPrefix "chapp":       "chapp"
 * From protoName "channel_app": usually re-derives the forms above; for
 *                              "OAuthApp" it contributes "oauth_app"/"oauth-app"
 * Plus the plural of every form above.
 */
export function generateAliases(
  name: string,
  displayName: string,
  idPrefix: string,
  protoName: string,
): string[] {
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

  // From name: "ChannelApp"
  add(name.toLowerCase()); // "channelapp"
  add(toKebabCase(name)); // "channel-app"
  add(toSnakeCase(name)); // "channel_app"
  add(name); // "ChannelApp"

  // From the proto enum value name: "channel_app". For most kinds this re-derives
  // the snake/kebab forms above, but it is the only source that knows the true
  // word boundaries when the PascalCase name has consecutive capitals — no split
  // of "OAuthApp" can recover "oauth_app", because "OAuth" being one word is
  // recorded only in the proto. Feeding it in makes "the canonical kind name
  // always resolves" structural instead of an accident of PascalCase spelling
  // (stigmer/stigmer#470).
  add(protoName); // "oauth_app"
  add(protoName.replaceAll("_", "-")); // "oauth-app"

  // From display_name: single-word names contribute lower/upper forms; for
  // multi-word names only the first word is added, and only when it does not
  // simply re-derive the name (this stops "Channel App" from stealing
  // "channel" from "Channel", while still letting a display name whose first word
  // is not the name's own prefix register that word).
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

  // From id_prefix: "chapp"
  add(idPrefix);

  // Plurals of every form gathered so far.
  for (const alias of [...aliases]) {
    add(pluralize(alias));
  }

  return aliases;
}

/** Convert PascalCase to kebab-case: "ChannelApp" -> "channel-app". */
export function toKebabCase(s: string): string {
  return splitCase(s, "-");
}

/** Convert PascalCase to snake_case: "ChannelApp" -> "channel_app". */
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
