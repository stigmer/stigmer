/**
 * The code fences the docs snippet gate compiles, read from the docs' MDX and
 * classified into the three kinds the gate accepts.
 *
 * Scanning follows CommonMark fence rules (the docs YAML gate's scanner,
 * `tools/codegen/src/generator/mdx-fence-scanner.ts`, follows the same ones):
 * a fence opened with N backticks closes only on a line of at least N
 * backticks, fences may be indented up to three spaces (inside list items)
 * and that indent is stripped from the body, and an unclosed fence is an
 * error, so a truncated block fails loudly instead of slipping past.
 *
 * Every TypeScript, Go, Python and Java fence is one of:
 *   - `no-compile="<reason>"`: pseudo-code, or a wrong value shown beside a
 *     right one; the reason must say why, so an empty one is refused;
 *   - a whole file: titled (`title="main.go"`), or a complete program by its
 *     language's shape (a Go `package` clause, a Java type declaration),
 *     compiled as it stands;
 *   - a fragment: compiled inside a prelude, the declarations and imports it
 *     assumes. `compile="<prelude>"` names one; otherwise the page's or the
 *     language's default applies (`preludes.mjs`).
 * `compile="file"` forces the whole-file reading for a block whose shape
 * reads as a fragment.
 */

/** Fence languages the gate compiles, mapped to the compiler that reads them. */
export const LANGUAGES = Object.freeze({
  typescript: "typescript",
  ts: "typescript",
  tsx: "typescript",
  go: "go",
  python: "python",
  py: "python",
  java: "java",
});

const NO_COMPILE = /(?:^|\s)no-compile="([^"]*)"/;
const COMPILE = /(?:^|\s)compile="([^"]*)"/;
const TITLE = /(?:^|\s)title="([^"]*)"/;

/**
 * Every fenced block in one markdown source.
 * @param {string} path the page's path, carried into each fence and error
 * @param {string} src the page's text
 * @returns {{path: string, line: number, lang: string, meta: string, body: string}[]}
 */
export function scanFences(path, src) {
  const fences = [];
  const lines = src.split("\n");
  let open = null;
  let body = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open === null) {
      const opening = parseOpening(line);
      if (opening === null) continue;
      const [lang, meta] = splitInfo(opening.info);
      open = { path, line: i + 1, lang, meta, body: "", ticks: opening.ticks, indent: opening.indent };
      body = [];
      continue;
    }
    if (isClosing(line, open.ticks)) {
      const { ticks: _t, indent: _i, ...fence } = open;
      fences.push({ ...fence, body: body.length > 0 ? `${body.join("\n")}\n` : "" });
      open = null;
      continue;
    }
    body.push(stripIndent(line, open.indent));
  }
  if (open !== null) {
    throw new Error(`${path}:${open.line}: unclosed code fence at end of file`);
  }
  return fences;
}

function parseOpening(line) {
  const indent = leading(line, " ");
  if (indent > 3) return null;
  const rest = line.slice(indent);
  const ticks = leading(rest, "`");
  if (ticks < 3) return null;
  const info = rest.slice(ticks).trim();
  if (info.includes("`")) return null;
  return { indent, ticks, info };
}

function isClosing(line, ticks) {
  const indent = leading(line, " ");
  if (indent > 3) return false;
  const rest = line.slice(indent);
  const n = leading(rest, "`");
  return n >= ticks && rest.slice(n).trim() === "";
}

function splitInfo(info) {
  if (info === "") return ["", ""];
  const idx = info.search(/[ \t]/);
  return idx >= 0 ? [info.slice(0, idx), info.slice(idx + 1).trim()] : [info, ""];
}

function leading(s, ch) {
  let n = 0;
  while (n < s.length && s[n] === ch) n++;
  return n;
}

function stripIndent(line, width) {
  let n = 0;
  while (n < width && n < line.length && line[n] === " ") n++;
  return line.slice(n);
}

/**
 * Whether a body is a complete program in its language, so it compiles as a
 * file rather than inside a prelude.
 */
export function isWholeProgram(language, body) {
  switch (language) {
    case "go":
      return /^package\s+\w+/m.test(body);
    case "java":
      return /^(?:public\s+|final\s+|abstract\s+)*(?:class|record|interface|enum)\s+\w+/m.test(body) || /^package\s+[\w.]+;/m.test(body);
    case "typescript":
    case "python":
      // Imports alone do not make a program here: a docs block that imports
      // what it shows still leans on the page's client and ids, so it is a
      // fragment unless titled or marked compile="file".
      return false;
    default:
      throw new Error(`no whole-program rule for ${language}`);
  }
}

/**
 * Classifies one fence. Returns null for a language the gate does not
 * compile.
 * @returns {null | {kind: "skip", language: string, reason: string}
 *   | {kind: "file", language: string}
 *   | {kind: "fragment", language: string, prelude: string | null}
 *   | {kind: "invalid", language: string, problem: string}}
 */
export function classify(fence) {
  const language = LANGUAGES[fence.lang];
  if (language === undefined) return null;
  const skip = NO_COMPILE.exec(fence.meta);
  const named = COMPILE.exec(fence.meta);
  if (skip !== null) {
    if (named !== null) return { kind: "invalid", language, problem: "a fence cannot carry both compile= and no-compile=" };
    const reason = skip[1].trim();
    if (reason === "") return { kind: "invalid", language, problem: 'no-compile="" needs a reason' };
    return { kind: "skip", language, reason };
  }
  if (named !== null) {
    const name = named[1].trim();
    if (name === "") return { kind: "invalid", language, problem: 'compile="" needs a prelude name, or "file"' };
    if (name === "file") return { kind: "file", language };
    return { kind: "fragment", language, prelude: name };
  }
  if (TITLE.test(fence.meta) || isWholeProgram(language, fence.body)) return { kind: "file", language };
  return { kind: "fragment", language, prelude: null };
}

/** The title a fence carries (`title="main.go"`), or "". */
export function fenceTitle(fence) {
  return TITLE.exec(fence.meta)?.[1] ?? "";
}

/** Whether a page carries a generator's marker, so its fences are fixed at the generator. */
export function isGeneratedPage(src) {
  return /\{\/\*\s*Auto-generated by [^*]*DO NOT EDIT\.\s*\*\/\}/.test(src);
}
