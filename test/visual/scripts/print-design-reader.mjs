#!/usr/bin/env node
/**
 * Prints the reader every design page reads its drawings with: `readPage`
 * from `tests/design-read.ts`, the function the design facts test reads a
 * built scene with, as one self-contained script for a page to embed
 * (`design/README.md`). Embedded, it defines `window.stigmerReadPage` and
 * `window.stigmerReaderStamp`, and the page's export writes that stamp into
 * every drawing it exports.
 *
 * The stamp is the first 12 hex characters of the reader's SHA-256, taken
 * over the function with its types and comments removed (TypeScript's
 * transpiler), so it moves only when what runs moves. The import copies it
 * into each facts file, and `src/__tests__/design-facts.test.ts` fails a
 * file whose stamp is not the current one: a change to the reader asks for
 * a fresh export of every page, and a page and the repository can't read
 * alike in name only, as a hand-kept copy of the reader once did. A
 * measurement is valid only against the tool that took it.
 *
 * Usage: node test/visual/scripts/print-design-reader.mjs [--stamp]
 *   With `--stamp`, prints the stamp alone.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));

/** The reader as a page runs it: its source without types or comments, and its stamp. */
export async function designReader() {
  const source = readFileSync(
    join(here, "..", "tests", "design-read.ts"),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
    },
  });
  const reader = await import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
  );
  const body = `window.stigmerReadPage = ${reader.readPage.toString()};\n`;
  const stamp = createHash("sha256").update(body).digest("hex").slice(0, 12);
  return {
    stamp,
    script: `// stigmer's design reader (test/visual/scripts/print-design-reader.mjs), stamp ${stamp}\nwindow.stigmerReaderStamp = "${stamp}";\n${body}`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { stamp, script } = await designReader();
  process.stdout.write(
    process.argv.includes("--stamp") ? `${stamp}\n` : script,
  );
}
