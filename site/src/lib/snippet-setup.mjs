/**
 * A code example's hidden setup: the lines above its `---cut---` marker.
 *
 * An example on a docs page may lean on names the page's prose introduces
 * (a `user` the previous step signed in). So that the docs snippet gate can
 * compile it without the reader wading through declarations, the fence may
 * open with setup lines ended by one marker line, `// ---cut---` in
 * TypeScript, Go and Java and `# ---cut---` in Python, twoslash's convention
 * carried to all four languages:
 *
 *     ```typescript
 *     declare const user: PlatformUser;
 *     // ---cut---
 *     await stigmer.run.create({ org: user.org, message: "…" });
 *     ```
 *
 * The gate compiles the setup (scripts/check-docs-snippets.mjs); the site
 * shows only what follows the marker, in the rendered block and its copy
 * button (./remark-snippet-setup.ts) and in the markdown exports
 * (`cleanContent` in ./llms-pages.ts). All three split through this one
 * function, so they cannot disagree on the marker.
 *
 * Plain JavaScript with no imports, its types beside it in
 * snippet-setup.d.mts, so the root gate (plain Node) and the site's
 * TypeScript both import it as it is.
 */

/** The marker line that ends a fence's setup, by the fence's language as written on the page. */
export const SETUP_MARKERS = Object.freeze({
  typescript: "// ---cut---",
  ts: "// ---cut---",
  tsx: "// ---cut---",
  go: "// ---cut---",
  java: "// ---cut---",
  python: "# ---cut---",
  py: "# ---cut---",
});

/**
 * Splits a fence's text at its marker. `setup` is every line above the
 * marker, `body` every line below it, and `hiddenLines` how many lines the
 * reader does not see (the setup and the marker). A fence with no marker, or
 * in a language that takes none, is all body. A second marker throws: the
 * setup ends once.
 *
 * @param {string | null | undefined} lang the fence's language (`ts`, `go`, …)
 * @param {string} text the fence's text, with or without a final newline
 * @returns {{ setup: string, body: string, hiddenLines: number }}
 */
export function splitSnippetSetup(lang, text) {
  const marker = lang == null ? undefined : SETUP_MARKERS[lang];
  if (marker === undefined) return { setup: "", body: text, hiddenLines: 0 };
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.trim() === marker);
  if (at < 0) return { setup: "", body: text, hiddenLines: 0 };
  const again = lines.findIndex((line, i) => i > at && line.trim() === marker);
  if (again >= 0) {
    throw new Error(`a ${lang} example has two "${marker}" lines (lines ${at + 1} and ${again + 1}); its setup ends once`);
  }
  return { setup: lines.slice(0, at).join("\n"), body: lines.slice(at + 1).join("\n"), hiddenLines: at + 1 };
}
