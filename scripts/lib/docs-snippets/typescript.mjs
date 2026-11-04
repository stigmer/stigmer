/**
 * The docs snippet gate's TypeScript compiler: every TypeScript and TSX
 * fence, compiled in one program against the workspace's own packages (their
 * built declarations, so `npm run build:libs` runs first).
 *
 * A fragment gets, in order: the gate's convention for what it uses and
 * does not declare (the client, `stigmer` or `client`, as an ambient
 * declaration; on a kit's pages, a name the kit's entry exports, imported
 * from it), the page's prelude, its own hidden setup at module level, then
 * its body. A fragment with a top-level `return` (a step inside a handler)
 * is compiled inside an async function, its imports kept outside. Every
 * file is a module, so two fences never see each other's declarations.
 *
 * Each unit compiles in a folder of its own, under its title when it has
 * one, beside a copy of every titled fence above it that it imports
 * (`./client.js`), so a page's files resolve as a reader's project would.
 *
 * On a kit's pages, a fence may import only what the kit's reader installs:
 * the kit's own package and its peer dependencies, read from the kit's
 * `package.json`. The workspace resolves every package, so without this rule
 * an import of a package the kit merely depends on would compile here and
 * fail in the reader's project.
 *
 * The files are virtual, placed under the repository root so module
 * resolution finds the workspace's `node_modules`; nothing is written.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { Assembly, located } from "./assemble.mjs";
import { conventionFor } from "./preludes.mjs";

const require = createRequire(import.meta.url);

const COMPILER_OPTIONS = {
  strict: true,
  target: "ES2022",
  module: "ESNext",
  moduleResolution: "Bundler",
  jsx: "react-jsx",
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  types: ["node"],
  skipLibCheck: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  resolveJsonModule: true,
  esModuleInterop: true,
  // The runner is a package of its own (its own lockfile, outside the npm
  // workspace), so the docs read its types from its source, as its published
  // declarations are built from it.
  paths: { "@stigmer/runner": ["./backend/services/runner/src/index.ts"] },
};

/**
 * Compiles the TypeScript units and returns their errors.
 * @param {object[]} units collect.mjs's units of one language
 * @param {{repoRoot: string, ts?: typeof import("typescript")}} opts
 * @returns {{id: number, page: string, line: number, message: string}[]}
 */
export function checkTypeScript(units, { repoRoot, ts = require(join(repoRoot, "node_modules", "typescript")) }) {
  const options = ts.convertCompilerOptionsFromJson(COMPILER_OPTIONS, repoRoot).options;
  const dir = join(repoRoot, ".docs-snippets");
  const exportsOf = entryExports(ts, options, dir, units);

  const assembled = new Map(units.map((u) => [u.id, assemble(ts, u, exportsOf)]));
  const byId = new Map(units.map((u) => [u.id, u]));
  const files = new Map();
  const texts = new Map();
  for (const unit of units) {
    const folder = join(dir, `u${unit.id}`);
    const fileName = join(folder, unit.title !== "" ? unit.title : `snippet.${unit.lang === "tsx" ? "tsx" : "ts"}`);
    const assembly = assembled.get(unit.id);
    files.set(fileName, { unit, assembly });
    texts.set(fileName, assembly.text());
    for (const sibling of unit.siblings) texts.set(join(folder, sibling.path), assembled.get(byId.get(sibling.id).id).text());
  }

  const host = virtualHost(ts, options, texts);
  const program = ts.createProgram([...files.keys()], options, host);
  const errors = uninstalledImports(ts, units, repoRoot);
  for (const [fileName, { unit, assembly }] of files) {
    const sf = program.getSourceFile(fileName);
    const diagnostics = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
    for (const d of diagnostics) {
      if (d.category !== ts.DiagnosticCategory.Error) continue;
      const line = d.start === undefined ? 0 : sf.getLineAndCharacterOfPosition(d.start).line + 1;
      errors.push(located(unit, assembly, line, ts.flattenDiagnosticMessageText(d.messageText, "\n")));
    }
  }
  return errors;
}

// The names each entry module exports, read once from the entries the
// units' preludes name.
function entryExports(ts, options, dir, units) {
  const entries = new Set();
  for (const u of units) for (const e of conventionFor(u.page, "typescript").entries) entries.add(e);
  const probe = join(dir, "entries.ts");
  const text = [...entries].map((e, i) => `import * as e${i} from ${JSON.stringify(e)};\nexport { e${i} };`).join("\n");
  const host = virtualHost(ts, options, new Map([[probe, text]]));
  const program = ts.createProgram([probe], options, host);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(probe);
  const result = new Map();
  const list = [...entries];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const spec = stmt.moduleSpecifier.text;
    const symbol = checker.getSymbolAtLocation(stmt.moduleSpecifier);
    if (symbol === undefined) throw new Error(`the snippet gate cannot resolve ${spec}; run npm run build:libs first`);
    result.set(spec, new Set(checker.getExportsOfModule(symbol).map((s) => s.name)));
  }
  for (const e of list) if (!result.has(e)) throw new Error(`the snippet gate read no exports of ${e}`);
  return result;
}

/**
 * The packages a reader of a kit's pages installs: the kit's own and its
 * peer dependencies, from the kit's `package.json`.
 * @param {string} repoRoot
 * @param {string} kit the kit's folder (`sdk/react`)
 * @returns {{name: string, peers: string[]}}
 */
export function kitPackages(repoRoot, kit) {
  const pkg = JSON.parse(readFileSync(join(repoRoot, kit, "package.json"), "utf8"));
  return { name: pkg.name, peers: Object.keys(pkg.peerDependencies ?? {}) };
}

/** The package an import names, without its subpath: `@stigmer/apis/ai/…` is `@stigmer/apis`. */
export function packageOf(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Every module some fence lines import (an import or export declaration, an
 * `import("…")` type or call, a `require("…")`), each with the page line it
 * is on.
 * @param {{text: string, line: number}[]} lines
 */
export function importedModules(ts, lines, tsx) {
  const sf = ts.createSourceFile(tsx ? "x.tsx" : "x.ts", lines.map((l) => l.text).join("\n"), ts.ScriptTarget.ES2022, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const add = (literal) => found.push({ specifier: literal.text, line: lines[sf.getLineAndCharacterOfPosition(literal.getStart(sf)).line].line });
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) add(node.moduleSpecifier);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) add(node.argument.literal);
    const loads = ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"));
    if (loads && node.arguments[0] !== undefined && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// An import on a kit's page of a package its reader does not install: one
// error per import line, at that line.
function uninstalledImports(ts, units, repoRoot) {
  const kits = new Map();
  const errors = [];
  for (const unit of units) {
    const { kit } = conventionFor(unit.page, "typescript");
    if (kit === undefined) continue;
    if (!kits.has(kit)) kits.set(kit, kitPackages(repoRoot, kit));
    const { name, peers } = kits.get(kit);
    const installed = new Set([name, ...peers]);
    for (const { specifier, line } of importedModules(ts, [...unit.prelude, ...unit.setup, ...unit.body], unit.lang === "tsx")) {
      if (specifier.startsWith(".") || specifier.startsWith("node:") || installed.has(packageOf(specifier))) continue;
      errors.push({
        id: unit.id,
        page: unit.page,
        line,
        message: `imports ${specifier}, which a reader of ${name} does not install: import from ${name} or a package it names as a peer dependency (${peers.join(", ")})`,
      });
    }
  }
  return errors;
}

function virtualHost(ts, options, files) {
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const text = files.get(fileName);
    if (text !== undefined) return ts.createSourceFile(fileName, text, languageVersion, true);
    return getSourceFile(fileName, languageVersion, onError, shouldCreate);
  };
  host.fileExists = (fileName) => files.has(fileName) || fileExists(fileName);
  // The virtual files' folders exist for module resolution, which asks for a
  // folder before it looks for a file in it.
  const folders = new Set();
  for (const fileName of files.keys()) for (let d = dirname(fileName); !folders.has(d) && d !== dirname(d); d = dirname(d)) folders.add(d);
  const directoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (dir) => folders.has(dir) || (directoryExists === undefined ? true : directoryExists(dir));
  host.readFile = (fileName) => files.get(fileName) ?? readFile(fileName);
  return host;
}

/** What a fence's body imports, declares and uses, read from its syntax alone. */
export function analyse(ts, body, tsx) {
  const sf = ts.createSourceFile(tsx ? "x.tsx" : "x.ts", body, ts.ScriptTarget.ES2022, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imported = new Set();
  const declared = new Set();
  const used = new Set();
  const importLines = new Set();
  let topLevelReturn = false;
  const signatureLines = new Set();
  let onlySignatures = true;

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.body === undefined) {
      signatureLines.add(sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line);
    } else if (!ts.isImportDeclaration(stmt) && !ts.isEmptyStatement(stmt)) {
      onlySignatures = false;
    }
    if (ts.isImportDeclaration(stmt)) {
      const start = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line;
      const end = sf.getLineAndCharacterOfPosition(stmt.getEnd()).line;
      for (let l = start; l <= end; l++) importLines.add(l);
      const clause = stmt.importClause;
      if (clause?.name) imported.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) imported.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) imported.add(el.name.text);
    }
  }

  const declareBinding = (name) => {
    if (ts.isIdentifier(name)) declared.add(name.text);
    else for (const el of name.elements) if (!ts.isOmittedExpression(el)) declareBinding(el.name);
  };

  const visit = (node, inFunction) => {
    if (ts.isReturnStatement(node) && !inFunction) topLevelReturn = true;
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
      node.name !== undefined
    ) {
      declareBinding(node.name);
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isTypeParameterDeclaration(node)) &&
      node.name !== undefined
    ) {
      declared.add(node.name.text);
    }
    if (ts.isIdentifier(node) && isReference(ts, node)) used.add(node.text);
    const fn = inFunction || ts.isFunctionLike(node) || ts.isClassLike(node);
    ts.forEachChild(node, (child) => visit(child, fn));
  };
  for (const stmt of sf.statements) if (!ts.isImportDeclaration(stmt)) visit(stmt, false);

  return { imported, declared, used, importLines, topLevelReturn, signatureLines, onlySignatures };
}

// Whether an identifier names something in scope, rather than a property, a
// key, an attribute or a declaration's own name.
function isReference(ts, id) {
  const p = id.parent;
  if (p === undefined) return true;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isQualifiedName(p) && p.right === id) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p)) && p.name === id) return false;
  if (ts.isJsxAttribute(p)) return false;
  if ((ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) && p.tagName === id) return /^[A-Z]/.test(id.text);
  if ((ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isEnumDeclaration(p) || ts.isTypeParameterDeclaration(p)) && p.name === id) return false;
  if (ts.isBindingElement(p) && p.propertyName === id) return false;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
  if (ts.isEnumMember(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) return false;
  if (ts.isShorthandPropertyAssignment(p)) return true;
  return true;
}

function assemble(ts, unit, exportsOf) {
  const a = new Assembly();
  if (unit.kind === "file") {
    a.addSource([...unit.setup, ...unit.body]);
    a.add("export {};");
    return a;
  }

  const convention = conventionFor(unit.page, "typescript");
  const tsx = unit.lang === "tsx";
  const text = (lines) => lines.map((l) => l.text).join("\n");
  // Names are read over everything the fragment compiles with; the shape
  // (a top-level return, a signature) over its body alone.
  const scope = analyse(ts, [text(unit.prelude), text(unit.setup), text(unit.body)].join("\n"), tsx);
  const info = analyse(ts, text(unit.body), tsx);
  // A signature block (a reference page's "Signature") declares without
  // implementing; it compiles as an ambient declaration, so the types it
  // names must still exist.
  const signature = info.signatureLines.size > 0 && info.onlySignatures;
  for (const name of [...scope.used].sort()) {
    if (scope.imported.has(name) || scope.declared.has(name)) continue;
    const contextType = convention.context[name];
    if (contextType !== undefined) {
      a.add(`declare const ${name}: ${contextType};`);
      continue;
    }
    const entry = convention.entries.find((e) => exportsOf.get(e)?.has(name));
    if (entry !== undefined) a.add(`import { ${name} } from ${JSON.stringify(entry)};`);
  }
  a.add("export {};");
  a.addPrelude(unit.prelude.map((l) => l.text), unit.prelude.map((l) => l.line));
  a.addSource(unit.setup);

  if (signature) {
    unit.body.forEach((l, i) => a.addSource([{ text: info.signatureLines.has(i) ? `declare ${l.text}` : l.text, line: l.line }]));
    return a;
  }
  if (!info.topLevelReturn) {
    a.addSource(unit.body);
    return a;
  }
  unit.body.forEach((l, i) => {
    if (info.importLines.has(i)) a.addSource([l]);
  });
  a.add("async function __snippet() {");
  unit.body.forEach((l, i) => {
    a.addSource([{ text: info.importLines.has(i) ? "" : l.text, line: l.line }]);
  });
  a.add("}");
  return a;
}
