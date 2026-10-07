/**
 * The Go half of a contract rename, driven by the Go compiler the same way
 * the TypeScript half is driven by tsc.
 *
 * After the Go stubs are regenerated, `go vet` (or `go build`) reports each
 * use of a renamed name: `undefined: X`, `undefined: pkg.X`, `x.Y undefined
 * (type T has no field or method Y)`, and an import path no module provides.
 * This module parses those lines, rewrites the flagged token on the flagged
 * line through the table's Go identifiers, and rewrites a moved package's
 * import path, renaming its alias in that file when the alias was the old
 * package's default name (`agentrunv1` becomes `runv1`, every `agentrunv1.`
 * in the file with it). The caller runs the compiler again until a round
 * rewrites nothing. Like the TypeScript half, a token the compiler does not
 * flag is never touched.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const LOCATION = /^(?<file>[^\s:][^:]*\.go):(?<line>\d+):(?<col>\d+): (?<message>.*)$/;

/**
 * The compiler's complaints, one `{ file, line, col, name }` per flagged
 * token, or `{ file, line, col, importPath }` for an import no module
 * provides. `vet:` prefixes and `# package` headers are skipped.
 */
export function parseGoDiagnostics(output) {
  const out = [];
  for (const raw of output.split("\n")) {
    const text = raw.replace(/^vet: /, "").trim();
    const m = LOCATION.exec(text);
    if (!m) continue;
    const { file, message } = m.groups;
    const where = { file, line: Number(m.groups.line), col: Number(m.groups.col) };
    let hit;
    if ((hit = /^undefined: (?:[A-Za-z_][\w]*\.)?([A-Za-z_]\w*)/.exec(message))) {
      out.push({ ...where, name: hit[1] });
    } else if ((hit = /undefined \(type .* has no (?:field or method|method) ([A-Za-z_]\w*)/.exec(message))) {
      out.push({ ...where, name: hit[1] });
    } else if ((hit = /unknown field ([A-Za-z_]\w*) in struct literal/.exec(message))) {
      out.push({ ...where, name: hit[1] });
    } else if (
      (hit = /(?:no required module provides package|cannot find package|could not import) "?([^"\s;:]+)"?/.exec(
        message,
      ))
    ) {
      out.push({ ...where, importPath: hit[1] });
    }
  }
  return out;
}

/** The import path after the rename, through the moved directories, or undefined. */
export function renamedImportPath(importPath, directories) {
  for (const [from, to] of Object.entries(directories)) {
    if (importPath.endsWith(`/${from}`)) return `${importPath.slice(0, importPath.length - from.length)}${to}`;
  }
  return undefined;
}

/**
 * Rewrite one file's lines for its complaints. Returns the new text and how
 * many rewrites it made; a complaint whose token the table does not rename is
 * returned in `left`.
 */
export function rewriteGoFile(text, complaints, table) {
  const lines = text.split("\n");
  const left = [];
  let count = 0;
  let renameAlias;
  for (const c of complaints) {
    const i = c.line - 1;
    if (i < 0 || i >= lines.length) {
      left.push(c);
      continue;
    }
    if (c.importPath) {
      const next = renamedImportPath(c.importPath, table.directories);
      if (!next || !lines[i].includes(`"${c.importPath}"`)) {
        left.push(c);
        continue;
      }
      lines[i] = lines[i].replace(`"${c.importPath}"`, `"${next}"`);
      count++;
      const alias = /^\s*([A-Za-z_]\w*)\s+"/.exec(lines[i]);
      if (alias && table.go.packageAliases[alias[1]]) {
        renameAlias = [alias[1], table.go.packageAliases[alias[1]]];
      }
      continue;
    }
    const to = table.go.identifiers[c.name];
    if (to === undefined) {
      left.push(c);
      continue;
    }
    const line = lines[i];
    const re = new RegExp(`\\b${c.name}\\b`, "g");
    let best;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (!best || Math.abs(m.index - (c.col - 1)) < Math.abs(best - (c.col - 1))) best = m.index;
    }
    if (best === undefined) {
      left.push(c);
      continue;
    }
    lines[i] = line.slice(0, best) + to + line.slice(best + c.name.length);
    count++;
  }
  let out = lines.join("\n");
  if (renameAlias) {
    const [from, to] = renameAlias;
    out = out.replace(new RegExp(`^(\\s*)${from}(\\s+")`, "m"), `$1${to}$2`);
    out = out.replace(new RegExp(`\\b${from}\\.`, "g"), `${to}.`);
    count++;
  }
  return { text: out, count, left };
}

/** One round over a module: parse the compiler output, rewrite each file once. */
export function runGoRound({ output, moduleDir, table }) {
  const byFile = new Map();
  for (const c of parseGoDiagnostics(output)) {
    const file = isAbsolute(c.file) ? c.file : join(moduleDir, c.file);
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(c);
  }
  let count = 0;
  const left = [];
  for (const [file, complaints] of byFile) {
    if (file.includes("/proto/") || file.endsWith(".pb.go")) {
      left.push(...complaints);
      continue;
    }
    const result = rewriteGoFile(readFileSync(file, "utf8"), complaints, table);
    if (result.count > 0) writeFileSync(file, result.text);
    count += result.count;
    left.push(...result.left);
  }
  return { count, left };
}
