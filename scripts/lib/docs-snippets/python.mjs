/**
 * The docs snippet gate's Python compiler: pyright (the root devDependency)
 * over each Python fence, in a virtual environment where the stubs and the
 * SDK are installed, so a call to a method or keyword the SDK lacks fails as
 * it would in a reader's editor. Python 3.11 is the SDK's floor
 * (`sdk/python/pyproject.toml`), so the check reads the fences as 3.11.
 *
 * A fragment gets the gate's convention (the client, bound with `cast` so
 * pyright knows its type, only when it uses it), the page's prelude and its
 * hidden setup at module level, then its body. A body with a `return` or
 * `await` and no function of its own goes inside one, its imports kept at
 * module level. Only errors count; pyright's warnings do not, so an unused prelude
 * import is never one.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Assembly, located } from "./assemble.mjs";
import { conventionFor } from "./preludes.mjs";

/**
 * @param {object[]} units the Python units
 * @param {{repoRoot: string, python?: string}} opts `python` is the venv's interpreter
 * @returns {{id: number, page: string, line: number, message: string}[]}
 */
export function checkPython(units, { repoRoot, python }) {
  if (python === undefined) {
    throw new Error("the Python check needs --python=<interpreter of a venv with the stubs and SDK installed>");
  }
  const dir = mkdtempSync(join(tmpdir(), "docs-snippets-py-"));
  try {
    const files = new Map();
    for (const unit of units) {
      const name = `snippet_${unit.id}.py`;
      const assembly = assemble(unit);
      writeFileSync(join(dir, name), assembly.text());
      files.set(join(dir, name), { unit, assembly });
    }
    writeFileSync(
      join(dir, "pyrightconfig.json"),
      JSON.stringify({ pythonVersion: "3.11", typeCheckingMode: "standard", reportMissingModuleSource: "none" }),
    );
    mkdirSync(join(dir, ".cache"), { recursive: true });
    let out;
    try {
      out = execFileSync(join(repoRoot, "node_modules", ".bin", "pyright"), ["--outputjson", "--pythonpath", python, "-p", join(dir, "pyrightconfig.json")], {
        cwd: dir,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (err) {
      // pyright exits 1 when it reports errors; its JSON is still on stdout.
      if (typeof err.stdout !== "string" || err.stdout === "") throw err;
      out = err.stdout;
    }
    const errors = [];
    for (const d of JSON.parse(out).generalDiagnostics) {
      if (d.severity !== "error") continue;
      const entry = files.get(d.file);
      if (entry === undefined) continue;
      errors.push(located(entry.unit, entry.assembly, d.range.start.line + 1, d.message));
    }
    return errors;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The body lines (0-based) that are module-level imports, a parenthesised one's continuation included. */
export function pythonImportLines(lines) {
  const taken = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!/^(?:import|from)\s/.test(lines[i])) continue;
    taken.add(i);
    if (lines[i].includes("(") && !lines[i].includes(")")) {
      let j = i + 1;
      for (; j < lines.length && !lines[j].includes(")"); j++) taken.add(j);
      taken.add(j);
      i = j;
    }
  }
  return taken;
}

function assemble(unit) {
  const a = new Assembly();
  if (unit.kind === "file") {
    a.addSource([...unit.setup, ...unit.body]);
    return a;
  }
  const convention = conventionFor(unit.page, "python");
  const lines = unit.body.map((l) => l.text);
  const used = [...unit.prelude, ...unit.setup, ...unit.body].map((l) => l.text).join("\n");
  a.add(...convention.imports);
  for (const [name, type] of Object.entries(convention.context)) {
    if (new RegExp(`\\b${name}\\b`).test(used)) a.add(`${name} = _stigmer_docs_cast(${JSON.stringify(type)}, None)`);
  }
  a.addPrelude(unit.prelude.map((l) => l.text), unit.prelude.map((l) => l.line));
  a.addSource(unit.setup);
  // A step inside a handler (a `return` or `await` with no `def` of its own
  // around it) compiles inside one.
  const text = lines.join("\n");
  const wrap = /^\s*(?:return\b|await\b|async\s+(?:for|with)\b)/m.test(text) && !/^\s*(?:async\s+)?def\s/m.test(text);
  if (!wrap) {
    a.addSource(unit.body);
    return a;
  }
  const imports = pythonImportLines(lines);
  unit.body.forEach((l, i) => {
    if (imports.has(i)) a.addSource([l]);
  });
  a.add("async def __snippet():", "    pass");
  unit.body.forEach((l, i) => {
    a.addSource([{ text: imports.has(i) || l.text === "" ? "" : `    ${l.text}`, line: l.line }]);
  });
  return a;
}
