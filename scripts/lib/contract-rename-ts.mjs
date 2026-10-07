/**
 * The TypeScript half of a contract rename: the compiler decides what is a
 * reference to the contract, and only what it flags is rewritten.
 *
 * After the stubs are regenerated, every use of a renamed contract name stops
 * compiling: a missing export, member, property, module or enum member, an
 * excess object-literal key, a discriminator string no longer in the union.
 * This module reads those diagnostics from the compiler's own program and
 * rewrites each at the node the diagnostic points to, through the rename
 * table's identifier and module maps, then compiles again, until a round
 * rewrites nothing. A string spelled like a contract name that the compiler
 * does not flag (an engine payload key, a Temporal name, a log line) is never
 * touched; that is the reason for the method, since text substitution cannot
 * tell `agentRunId` the proto field from `agentRunId` an engine key.
 *
 * Shapes it handles, each at its exact node: a plain identifier; a shorthand
 * property or binding (`{ agentRunId }` becomes `{ runId: agentRunId }`, so
 * the local keeps its name); an import or export specifier (the import is
 * renamed, and the next round renames the file's uses); a module specifier,
 * through the table's module map or a moved directory; a string literal the
 * compiler rejects inside the diagnostic's span (`case: "agentRunId"`).
 * Everything else stays a diagnostic the run reports, for a person to read.
 * Generated trees (`--exclude`) are never edited: a diagnostic there means
 * the generator has not been re-run.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Diagnostics whose node is a name the contract no longer has. */
const NAME_CODES = new Set([
  2304, // Cannot find name
  2305, // Module has no exported member
  2339, // Property does not exist on type
  2351, // no construct signatures (rare; same node)
  2353, // Object literal may only specify known properties
  2459, // Module declares locally but does not export
  2460, // Module declares locally, exported under another name
  2551, // Property does not exist. Did you mean
  2552, // Cannot find name. Did you mean
  2561, // Object literal may only specify known properties. Did you mean
  2614, // Module has no exported member. Did you mean default import
  2694, // Namespace has no exported member
  2724, // Module has no exported member. Did you mean
]);

/** Diagnostics where a string literal in the span may be a renamed discriminator. */
const LITERAL_CODES = new Set([2322, 2345, 2367, 2678, 2820]);

/** Diagnostics whose node is a module specifier that no longer resolves. */
const MODULE_CODES = new Set([2307, 2792]);

/** Load the compiler the package itself pins, else the repository root's. */
export function loadTypeScript(projectDir, rootDir) {
  for (const from of [projectDir, rootDir]) {
    try {
      return createRequire(join(from, "noop.js"))("typescript");
    } catch {
      // try the next
    }
  }
  throw new Error(`no typescript resolvable from ${projectDir} or ${rootDir}`);
}

/** The innermost node whose span contains `pos`. */
function nodeAt(ts, sourceFile, pos) {
  let found = sourceFile;
  const visit = (node) => {
    if (node.getStart(sourceFile) <= pos && pos < node.getEnd()) {
      found = node;
      ts.forEachChild(node, visit);
    }
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/** Every string literal fully inside [start, end). */
function literalsIn(ts, sourceFile, start, end) {
  const out = [];
  const visit = (node) => {
    const s = node.getStart(sourceFile);
    if (node.getEnd() <= start || s >= end) return;
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && s >= start && node.getEnd() <= end) {
      out.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

/**
 * A module specifier after the rename, or undefined. Package specifiers go
 * through the table's module map (`…/agentrun/v1/api_pb` to `…/run/v1/api_pb`,
 * with or without `.js`); relative ones through the moved directories, so a
 * file that imports from a moved domain folder follows it.
 */
export function renamedSpecifier(spec, fromFile, modules, moves) {
  if (spec.startsWith(".")) {
    const target = resolve(dirname(fromFile), spec);
    for (const [from, to] of Object.entries(moves)) {
      if (target === from || target.startsWith(from + sep)) {
        let next = relative(dirname(fromFile), to + target.slice(from.length));
        if (!next.startsWith(".")) next = `./${next}`;
        return next.split(sep).join("/");
      }
    }
    return undefined;
  }
  for (const [from, to] of Object.entries(modules)) {
    for (const suffix of ["", ".js"]) {
      if (spec.endsWith(`${from}${suffix}`))
        return `${spec.slice(0, spec.length - from.length - suffix.length)}${to}${suffix}`;
    }
  }
  return undefined;
}

/**
 * The edits one diagnostic asks for: `[{ start, end, text }]`, or an empty
 * list when the node is not one this pass may rewrite.
 */
export function editsForDiagnostic(ts, sourceFile, diagnostic, table, moves) {
  const { code, start, length } = diagnostic;
  const identifiers = table.ts.identifiers;
  if (MODULE_CODES.has(code)) {
    const node = nodeAt(ts, sourceFile, start);
    if (!ts.isStringLiteral(node)) return [];
    const next = renamedSpecifier(node.text, sourceFile.fileName, table.ts.modules, moves);
    if (next === undefined) return [];
    return [{ start: node.getStart(sourceFile) + 1, end: node.getEnd() - 1, text: next }];
  }
  if (NAME_CODES.has(code)) {
    const node = nodeAt(ts, sourceFile, start);
    if (!ts.isIdentifier(node)) return [];
    const to = identifiers[node.text];
    if (to === undefined) return [];
    const parent = node.parent;
    const at = { start: node.getStart(sourceFile), end: node.getEnd() };
    if (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
      return [{ ...at, text: `${to}: ${node.text}` }];
    }
    if (
      parent &&
      ts.isBindingElement(parent) &&
      parent.propertyName === undefined &&
      parent.name === node &&
      ts.isObjectBindingPattern(parent.parent)
    ) {
      return [{ ...at, text: `${to}: ${node.text}` }];
    }
    return [{ ...at, text: to }];
  }
  if (LITERAL_CODES.has(code) && start !== undefined) {
    let span = [start, start + (length ?? 0)];
    const node = nodeAt(ts, sourceFile, start);
    // A property flagged by name (`case: "x"`): the literal is its value.
    if (ts.isIdentifier(node) && node.parent && ts.isPropertyAssignment(node.parent)) {
      span = [node.parent.getStart(sourceFile), node.parent.getEnd()];
    }
    return literalsIn(ts, sourceFile, span[0], span[1])
      .filter((lit) => identifiers[lit.text] !== undefined)
      .map((lit) => ({ start: lit.getStart(sourceFile) + 1, end: lit.getEnd() - 1, text: identifiers[lit.text] }));
  }
  return [];
}

/** Apply edits to one text, last first; overlapping or repeated edits keep the first. */
export function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const kept = [];
  for (const e of sorted) {
    const last = kept.at(-1);
    if (last && e.start < last.end) continue;
    kept.push(e);
  }
  let out = text;
  for (const e of kept.reverse()) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { text: out, applied: kept.length };
}

/** Every tsconfig a solution-style tsconfig reaches, itself first. */
function projectConfigs(ts, configPath, seen = new Set()) {
  const abs = resolve(configPath);
  if (seen.has(abs)) return [];
  seen.add(abs);
  const parsed = ts.getParsedCommandLineOfConfigFile(
    abs,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (!parsed) throw new Error(`cannot read ${abs}`);
  const out = [{ path: abs, parsed }];
  for (const ref of parsed.projectReferences ?? []) {
    const refPath = ts.resolveProjectReferencePath(ref);
    out.push(...projectConfigs(ts, refPath, seen));
  }
  return out;
}

/**
 * Run the pass over one tsconfig until a round rewrites nothing. Returns the
 * rounds, the files edited, and the diagnostics left (each `file:line:col
 * TScode message`), for the run to print.
 */
export function runTypeScriptPass({
  tsconfig,
  table,
  moves = {},
  exclude = [],
  rootDir = process.cwd(),
  maxRounds = 12,
  log = () => {},
}) {
  const ts = loadTypeScript(dirname(resolve(tsconfig)), rootDir);
  const absMoves = Object.fromEntries(
    Object.entries(moves).map(([f, t]) => [resolve(rootDir, f), resolve(rootDir, t)]),
  );
  const excluded = (file) =>
    file.includes(`${sep}node_modules${sep}`) || exclude.some((e) => file.includes(isAbsolute(e) ? e : `${sep}${e}`));
  const edited = new Set();
  let rounds = 0;
  let remaining = [];
  for (; rounds < maxRounds; rounds++) {
    const perFile = new Map();
    remaining = [];
    for (const { parsed } of projectConfigs(ts, tsconfig)) {
      if (parsed.fileNames.length === 0) continue;
      const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
      const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
      for (const d of diagnostics) {
        if (!d.file || d.start === undefined) continue;
        const file = d.file.fileName;
        const edits = excluded(file) ? [] : editsForDiagnostic(ts, d.file, d, table, absMoves);
        if (edits.length === 0) {
          const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
          remaining.push(
            `${relative(rootDir, file)}:${line + 1}:${character + 1} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`,
          );
          continue;
        }
        if (!perFile.has(file)) perFile.set(file, []);
        perFile.get(file).push(...edits);
      }
    }
    if (perFile.size === 0) break;
    let applied = 0;
    for (const [file, edits] of perFile) {
      const { text, applied: n } = applyEdits(readFileSync(file, "utf8"), edits);
      writeFileSync(file, text);
      edited.add(file);
      applied += n;
    }
    log(`round ${rounds + 1}: ${applied} edits in ${perFile.size} files`);
  }
  return { rounds, edited: [...edited].sort(), remaining: [...new Set(remaining)] };
}

/**
 * Rename hand-written names that mirror the contract (a store method, a
 * hook, a library type) through the compiler's own rename: every declaration
 * named in `names` and every reference the language service finds for it,
 * implementations of an interface member included. The rename is public:
 * a re-export and a shorthand key take the new name too (`export { useX }`
 * becomes `export { useY }`, never `useY as useX`), because the names this
 * pass is given are API that follows the contract. A declaration spelled
 * like a given name is renamed with it, so the names must be distinctive.
 * Run before the diagnostic pass, so that packages outside this program meet
 * the new names as flagged imports.
 */
export function runRenamePass({ tsconfig, names, exclude = [], rootDir = process.cwd() }) {
  const ts = loadTypeScript(dirname(resolve(tsconfig)), rootDir);
  const excluded = (file) =>
    file.includes(`${sep}node_modules${sep}`) || exclude.some((e) => file.includes(isAbsolute(e) ? e : `${sep}${e}`));
  const edited = new Set();
  const renamed = new Map();
  for (const { parsed } of projectConfigs(ts, tsconfig)) {
    if (parsed.fileNames.length === 0) continue;
    const versions = new Map();
    const host = {
      getScriptFileNames: () => parsed.fileNames,
      getScriptVersion: (f) => String(versions.get(f) ?? 0),
      getScriptSnapshot: (f) => (ts.sys.fileExists(f) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)) : undefined),
      getCurrentDirectory: () => dirname(resolve(tsconfig)),
      getCompilationSettings: () => parsed.options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };
    const service = ts.createLanguageService(host, ts.createDocumentRegistry());
    for (;;) {
      const program = service.getProgram();
      let target;
      for (const sf of program.getSourceFiles()) {
        if (excluded(sf.fileName) || sf.isDeclarationFile) continue;
        const visit = (node) => {
          if (target) return;
          const name = node.name;
          if (name && ts.isIdentifier(name) && names[name.text] !== undefined && isDeclaration(ts, node)) {
            target = { file: sf.fileName, pos: name.getStart(sf), from: name.text };
            return;
          }
          ts.forEachChild(node, visit);
        };
        visit(sf);
        if (target) break;
      }
      if (!target) break;
      const to = names[target.from];
      const locations =
        service.findRenameLocations(target.file, target.pos, false, false, {
          providePrefixAndSuffixTextForRename: false,
        }) ?? [];
      const perFile = new Map();
      for (const loc of locations) {
        if (excluded(loc.fileName)) continue;
        const text = `${loc.prefixText ?? ""}${to}${loc.suffixText ?? ""}`;
        if (!perFile.has(loc.fileName)) perFile.set(loc.fileName, []);
        perFile
          .get(loc.fileName)
          .push({ start: loc.textSpan.start, end: loc.textSpan.start + loc.textSpan.length, text });
      }
      if (perFile.size === 0) throw new Error(`no rename locations for ${target.from} in ${target.file}`);
      for (const [file, edits] of perFile) {
        writeFileSync(file, applyEdits(readFileSync(file, "utf8"), edits).text);
        versions.set(file, (versions.get(file) ?? 0) + 1);
        edited.add(file);
      }
      renamed.set(target.from, (renamed.get(target.from) ?? 0) + locations.length);
    }
  }
  return { edited: [...edited].sort(), renamed: Object.fromEntries(renamed) };
}

/** A node that declares its `name` (not a reference, and not a parameter). */
function isDeclaration(ts, node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isPropertyDeclaration(node)
  );
}
