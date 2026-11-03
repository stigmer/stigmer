/**
 * The docs snippet gate's Python compiler: pyright (the root devDependency)
 * over each Python fence, in a virtual environment where the stubs and the
 * SDK are installed, so a call to a method or keyword the SDK lacks fails as
 * it would in a reader's editor. Python 3.11 is the SDK's floor
 * (`sdk/python/pyproject.toml`), so the check reads the fences as 3.11.
 *
 * A fragment gets its prelude's imports and its context names (bound with
 * `cast`, so pyright knows their type, and only those it uses). A fragment
 * with a top-level `return` or `await` goes inside a function, its imports
 * kept at module level. Only errors count; pyright's warnings do not.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Assembly, bodyLines } from "./assemble.mjs";
import { PYTHON_PRELUDES } from "./preludes.mjs";

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
      const pageLine = entry.assembly.pageLine(d.range.start.line + 1);
      errors.push({
        id: entry.unit.id,
        page: entry.unit.page,
        line: pageLine ?? entry.unit.line,
        message: pageLine === null ? `${d.message} (in the gate's prelude for this fence)` : d.message,
      });
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
  const lines = bodyLines(unit.body);
  const first = unit.line + 1;
  const a = new Assembly();
  if (unit.kind === "file") {
    a.addBody(lines, first);
    return a;
  }
  const prelude = unit.prelude ?? PYTHON_PRELUDES.sdk;
  const text = lines.join("\n");
  a.add("from typing import cast", ...prelude.imports);
  for (const [name, type] of Object.entries(prelude.context)) {
    if (new RegExp(`\\b${name}\\b`).test(text)) a.add(`${name} = cast(${JSON.stringify(type)}, None)`);
  }
  const wrap = /^(?:return\b|await\b|async\s+(?:for|with)\b)/m.test(text);
  if (!wrap) {
    a.addBody(lines, first);
    return a;
  }
  const imports = pythonImportLines(lines);
  lines.forEach((line, i) => {
    if (imports.has(i)) a.addBody([line], first + i);
  });
  a.add("async def __snippet():", "    pass");
  lines.forEach((line, i) => {
    a.addBody([imports.has(i) || line === "" ? "" : `    ${line}`], first + i);
  });
  return a;
}
