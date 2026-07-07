/**
 * Parser for the `--stgm-*` token contract in this package's CSS files.
 *
 * The theme CSS is machine-formatted (one declaration per line, flat
 * top-level blocks, no nesting), so a deliberate line-oriented parser is
 * sufficient and keeps this package dependency-free. It understands the two
 * kinds of files we ship:
 *
 * - `tokens.css` — defaults: `:root { light }` +
 *   `[data-stgm-color-mode="dark"] { dark }`
 * - `presets/*.css` — overrides: `.stgm-theme-<id> { light }` +
 *   `[data-stgm-color-mode="dark"] .stgm-theme-<id>, ... { dark }`
 *
 * A block is classified `dark` when its selector mentions
 * `data-stgm-color-mode="dark"`, otherwise `light` — the same rule for both
 * file kinds.
 *
 * The parser also captures documentation structure used by the token-docs
 * generator:
 *
 * - `@group` comments (`/* @group Core colors — ... *\/`) start a named
 *   group; every following declaration belongs to it until the next header.
 * - A plain comment line immediately preceding a declaration is that
 *   token's purpose description.
 */

/** One `--stgm-*` custom property declaration with its documentation. */
export interface TokenDeclaration {
  /** Full custom property name, e.g. `--stgm-background`. */
  readonly name: string;
  /** Raw CSS value, e.g. `oklch(0.98 0 0)`. */
  readonly value: string;
  /** Purpose description from the comment line preceding the declaration. */
  readonly description?: string;
  /** Group name from the most recent `@group` header, e.g. `Core colors`. */
  readonly group?: string;
}

/** All `--stgm-*` declarations of one CSS file, split by color mode. */
export interface ThemeFileTokens {
  readonly light: ReadonlyMap<string, TokenDeclaration>;
  readonly dark: ReadonlyMap<string, TokenDeclaration>;
}

const TOKEN_DECLARATION = /^(--stgm-[\w-]+)\s*:\s*(.+?);\s*$/;
const GROUP_HEADER = /^\/\*\s*@group\s+(.+?)\s*(?:\*\/)?$/;

/**
 * Parse a theme CSS file into light/dark token maps.
 *
 * Later blocks of the same mode overwrite earlier ones, mirroring CSS
 * source-order behavior for equal-specificity selectors.
 */
export function parseThemeCss(css: string): ThemeFileTokens {
  const light = new Map<string, TokenDeclaration>();
  const dark = new Map<string, TokenDeclaration>();

  let insideBlock = false;
  let blockIsDark = false;
  let selectorBuffer = "";
  let currentGroup: string | undefined;
  let pendingDescription: string | undefined;
  let insideMultilineComment = false;

  for (const rawLine of css.split("\n")) {
    const line = rawLine.trim();

    if (insideMultilineComment) {
      if (line.includes("*/")) insideMultilineComment = false;
      continue;
    }

    if (!insideBlock) {
      // Accumulate selector text until the opening brace; a selector list
      // (the preset dark dual selector) can span multiple lines.
      if (line.length === 0) continue;
      if (line.startsWith("/*")) {
        if (!line.includes("*/")) insideMultilineComment = true;
        continue;
      }
      selectorBuffer += ` ${line}`;
      if (selectorBuffer.includes("{")) {
        blockIsDark = selectorBuffer.includes('data-stgm-color-mode="dark"');
        insideBlock = true;
        selectorBuffer = "";
        currentGroup = undefined;
        pendingDescription = undefined;
      }
      continue;
    }

    if (line.startsWith("}")) {
      insideBlock = false;
      continue;
    }

    const groupMatch = GROUP_HEADER.exec(line);
    if (groupMatch) {
      currentGroup = groupMatch[1];
      if (!line.includes("*/")) insideMultilineComment = true;
      pendingDescription = undefined;
      continue;
    }

    if (line.startsWith("/*")) {
      if (!line.includes("*/")) {
        insideMultilineComment = true;
        pendingDescription = undefined;
        continue;
      }
      pendingDescription = line.replace(/^\/\*\s*/, "").replace(/\s*\*\/$/, "");
      continue;
    }

    const declMatch = TOKEN_DECLARATION.exec(line);
    if (declMatch) {
      const declaration: TokenDeclaration = {
        name: declMatch[1],
        value: declMatch[2],
        ...(pendingDescription !== undefined && { description: pendingDescription }),
        ...(currentGroup !== undefined && { group: currentGroup }),
      };
      (blockIsDark ? dark : light).set(declaration.name, declaration);
    }
    // Any non-comment line (declaration or otherwise) consumes the pending
    // description — a comment only documents the line directly beneath it.
    pendingDescription = undefined;
  }

  return { light, dark };
}
