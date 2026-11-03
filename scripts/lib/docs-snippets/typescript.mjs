/**
 * The docs snippet gate's TypeScript compiler: every TypeScript and TSX
 * fence, compiled in one program against the workspace's own packages (their
 * built declarations, so `npm run build:libs` runs first).
 *
 * A fragment gets what it uses and does not declare: a context name
 * (`stigmer`, `id`) as an ambient declaration of its prelude's type, any
 * other name imported from the first of its prelude's entries that exports
 * it. A fragment with a top-level `return` (a step inside a handler) is
 * compiled inside an async function, its imports kept outside. Every file is
 * a module, so two fences never see each other's declarations.
 *
 * The files are virtual, placed under the repository root so module
 * resolution finds the workspace's `node_modules`; nothing is written.
 */

import { createRequire } from "node:module";
import { join } from "node:path";

import { Assembly, bodyLines } from "./assemble.mjs";
import { TYPESCRIPT_PRELUDES } from "./preludes.mjs";

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
};

/**
 * Compiles the TypeScript units and returns their errors.
 * @param {{id: number, page: string, line: number, lang: string, kind: "file" | "fragment", prelude: object | null, body: string}[]} units
 * @param {{repoRoot: string, ts?: typeof import("typescript")}} opts
 * @returns {{id: number, page: string, line: number, message: string}[]}
 */
export function checkTypeScript(units, { repoRoot, ts = require(join(repoRoot, "node_modules", "typescript")) }) {
  const options = ts.convertCompilerOptionsFromJson(COMPILER_OPTIONS, repoRoot).options;
  const dir = join(repoRoot, ".docs-snippets");
  const exportsOf = entryExports(ts, options, dir, units);

  const files = new Map();
  for (const unit of units) {
    const ext = unit.lang === "tsx" ? "tsx" : "ts";
    const fileName = join(dir, `snippet-${unit.id}.${ext}`);
    files.set(fileName, { unit, assembly: assemble(ts, unit, exportsOf) });
  }

  const host = virtualHost(ts, options, new Map([...files].map(([f, v]) => [f, v.assembly.text()])));
  const program = ts.createProgram([...files.keys()], options, host);
  const errors = [];
  for (const [fileName, { unit, assembly }] of files) {
    const sf = program.getSourceFile(fileName);
    const diagnostics = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
    for (const d of diagnostics) {
      if (d.category !== ts.DiagnosticCategory.Error) continue;
      const line = d.start === undefined ? 0 : sf.getLineAndCharacterOfPosition(d.start).line + 1;
      const pageLine = assembly.pageLine(line);
      const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      errors.push({
        id: unit.id,
        page: unit.page,
        line: pageLine ?? unit.line,
        message: pageLine === null ? `${message} (in the gate's prelude for this fence)` : message,
      });
    }
  }
  return errors;
}

// The names each entry module exports, read once from the entries the
// units' preludes name.
function entryExports(ts, options, dir, units) {
  const entries = new Set();
  for (const u of units) for (const e of u.prelude?.entries ?? []) entries.add(e);
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
  const lines = bodyLines(unit.body);
  const first = unit.line + 1;
  const a = new Assembly();
  if (unit.kind === "file") {
    a.addBody(lines, first);
    a.add("export {};");
    return a;
  }

  const prelude = unit.prelude ?? TYPESCRIPT_PRELUDES.client;
  const info = analyse(ts, unit.body, unit.lang === "tsx");
  // A signature block (a reference page's "Signature") declares without
  // implementing; it compiles as an ambient declaration, so the types it
  // names must still exist.
  const signature = info.signatureLines.size > 0 && info.onlySignatures;
  for (const name of [...info.used].sort()) {
    if (info.imported.has(name) || info.declared.has(name)) continue;
    const contextType = prelude.context[name];
    if (contextType !== undefined) {
      a.add(`declare const ${name}: ${contextType};`);
      continue;
    }
    const entry = prelude.entries.find((e) => exportsOf.get(e)?.has(name));
    if (entry !== undefined) a.add(`import { ${name} } from ${JSON.stringify(entry)};`);
  }
  a.add("export {};");

  if (signature) {
    lines.forEach((line, i) => a.addBody([info.signatureLines.has(i) ? `declare ${line}` : line], first + i));
    return a;
  }
  if (!info.topLevelReturn) {
    a.addBody(lines, first);
    return a;
  }
  lines.forEach((line, i) => {
    if (info.importLines.has(i)) a.addBody([line], first + i);
  });
  a.add("async function __snippet() {");
  lines.forEach((line, i) => {
    a.addBody([info.importLines.has(i) ? "" : line], first + i);
  });
  a.add("}");
  return a;
}
