import { Fragment, type ReactNode } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { createLowlight } from "lowlight";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";

// Dependency licensing (DD-012): `lowlight` and `hast-util-to-jsx-runtime` are
// MIT; `highlight.js` is BSD-3-Clause. BSD-3-Clause is a permissive, OSI-approved
// license, compatible with MIT/Apache-2.0, that imposes no obligations on SDK
// consumers beyond attribution — so it satisfies DD-012's "MIT or Apache-2.0
// compatible" rule. Recorded here so the choice is auditable at the point of use.
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * Syntax highlighter for fenced code blocks in SDK markdown surfaces.
 *
 * This is the single highlighting engine behind the shared `code` override in
 * {@link file://./markdown-components.tsx} — so chat (Streamdown) and the
 * artifact/skill viewers (react-markdown) colorize code identically.
 *
 * The engine emits highlight.js token classes (`hljs-keyword`, `hljs-string`,
 * …) which `styles.css` maps onto the `--stgm-syntax-*` theme tokens. Colors
 * are therefore 100% token-driven: they track the host's preset and color-mode
 * with no hardcoded values, exactly like the CodeMirror YAML editor.
 *
 * **Eager, not lazy.** Highlighting is on the core path (almost every
 * `SessionViewer` consumer renders agent messages containing code), so DD-013's
 * lazy pattern (for rarely-used heavy deps) does not apply. The grammars are
 * imported eagerly; because this module is only reachable through the markdown
 * components, normal tree-shaking still keeps it out of bundles that never
 * render markdown.
 *
 * **Curated grammar set.** Only the languages agents commonly emit are
 * registered, to keep the payload small. Anything else falls back to flat
 * rendering (see {@link resolveLanguage}) — a deterministic choice, never
 * highlight.js auto-detection, consistent with this codebase's avoidance of
 * fuzzy heuristics.
 */
const lowlight = createLowlight({
  bash,
  css,
  dockerfile,
  go,
  java,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
});

// Fence info-strings agents use that aren't already registered as grammar
// aliases by highlight.js. `xml` is highlight.js's grammar for HTML markup.
lowlight.registerAlias({
  bash: ["sh", "shell", "zsh", "console"],
  dockerfile: ["docker"],
  javascript: ["js", "jsx", "mjs", "cjs"],
  markdown: ["md"],
  python: ["py"],
  typescript: ["ts", "tsx"],
  xml: ["html"],
  yaml: ["yml"],
});

const jsxRuntime = { Fragment, jsx, jsxs } as const;

/**
 * Resolves a fence info-string to a registered highlight.js language name, or
 * `null` when no grammar is registered for it (the caller then renders the code
 * flat). Case-insensitive and whitespace-tolerant; never guesses.
 *
 * @param language - The raw language from a `language-*` class (e.g. `"go"`).
 * @returns The normalized, registered language name, or `null`.
 */
export function resolveLanguage(language: string | undefined): string | null {
  if (!language) return null;
  const name = language.trim().toLowerCase();
  return name && lowlight.registered(name) ? name : null;
}

/**
 * Highlights `code` for the given fence `language` and returns themed React
 * nodes — token `<span>`s carrying `hljs-*` classes that `styles.css` maps to
 * `--stgm-syntax-*`.
 *
 * Returns `null` (so the caller can fall back to flat rendering) when the
 * language has no registered grammar or tokenization throws. Highlighting is
 * synchronous: there is no loading state to handle.
 *
 * @param code - The raw source text of the fenced block.
 * @param language - The fence language (e.g. `"ts"`); unknown → `null`.
 */
export function highlightToReact(
  code: string,
  language: string | undefined,
): ReactNode | null {
  const resolved = resolveLanguage(language);
  if (resolved === null) return null;
  try {
    return toJsxRuntime(lowlight.highlight(resolved, code), jsxRuntime);
  } catch {
    return null;
  }
}
