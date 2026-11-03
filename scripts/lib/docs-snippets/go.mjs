/**
 * The docs snippet gate's Go compiler: assembles each Go fence into a file
 * of `package main` and type-checks it with the standard library's
 * `go/types` (the tool module beside this file), against export data
 * `go list -export` builds for the SDK module and the packages the fences
 * import.
 *
 * A whole program (a `package` clause) is checked as it stands. A fragment
 * gets its prelude's imports (minus any name it imports itself), its context
 * names as package variables (only those it uses and does not declare at
 * package level), and goes inside a function, unless it declares functions
 * or types of its own at the left margin, when it stays at package level.
 *
 * Only "declared and not used" is ignored (the tool says why), and an unused
 * import the prelude added: a fragment uses the prelude it needs, not all of
 * it.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { Assembly, bodyLines } from "./assemble.mjs";
import { GO_PRELUDES } from "./preludes.mjs";

const TOOL_DIR = new URL("./go/", import.meta.url).pathname;

/**
 * @param {object[]} units the Go units
 * @param {{repoRoot: string}} opts
 * @returns {{id: number, page: string, line: number, message: string}[]}
 */
export function checkGo(units, { repoRoot }) {
  const assembled = units.map((u) => ({ unit: u, ...assemble(u) }));
  const paths = new Set();
  for (const a of assembled) for (const p of a.imports) paths.add(p);
  const exports = exportData(repoRoot, [...paths]);
  const out = execFileSync("go", ["run", "."], {
    cwd: TOOL_DIR,
    env: { ...process.env, GOWORK: "off", GOFLAGS: "-mod=mod" },
    input: JSON.stringify({ exports, units: assembled.map((a) => ({ id: a.unit.id, src: a.assembly.text() })) }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const byId = new Map(assembled.map((a) => [a.unit.id, a]));
  const errors = [];
  for (const f of JSON.parse(out)) {
    const { unit, assembly } = byId.get(f.id);
    const pageLine = f.line === 0 ? null : assembly.pageLine(f.line);
    if (pageLine === null && /imported (?:as \w+ )?and not used/.test(f.message)) continue;
    errors.push({
      id: unit.id,
      page: unit.page,
      line: pageLine ?? unit.line,
      message: pageLine === null ? `${f.message} (in the gate's prelude for this fence)` : f.message,
    });
  }
  return errors;
}

// Export data for every package the fences import and their dependencies,
// built in the SDK module so its requirements resolve them.
function exportData(repoRoot, paths) {
  const out = execFileSync("go", ["list", "-e", "-export", "-deps", "-json=ImportPath,Export,Error", ...paths], {
    cwd: join(repoRoot, "sdk", "go"),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const exports = {};
  // `go list -json` prints one object after another, not an array.
  for (const chunk of out.split(/\n(?=\{)/)) {
    if (chunk.trim() === "") continue;
    const pkg = JSON.parse(chunk);
    if (pkg.Export) exports[pkg.ImportPath] = pkg.Export;
  }
  return exports;
}

const IMPORT_LINE = /^import\s+(?:(\w+|\.|_)\s+)?"([^"]+)"\s*$/;
const IMPORT_BLOCK_OPEN = /^import\s*\(\s*$/;
const BLOCK_ENTRY = /^\s*(?:(\w+|\.|_)\s+)?"([^"]+)"\s*(?:\/\/.*)?$/;

/** A fence's own imports (name, path, body line index) and the lines they take. */
export function goImports(lines) {
  const imports = [];
  const taken = new Set();
  for (let i = 0; i < lines.length; i++) {
    const single = IMPORT_LINE.exec(lines[i]);
    if (single !== null) {
      imports.push({ name: single[1] ?? lastSegment(single[2]), path: single[2], line: i, alias: single[1] });
      taken.add(i);
      continue;
    }
    if (IMPORT_BLOCK_OPEN.test(lines[i])) {
      taken.add(i);
      let j = i + 1;
      for (; j < lines.length && lines[j].trim() !== ")"; j++) {
        taken.add(j);
        const entry = BLOCK_ENTRY.exec(lines[j]);
        if (entry !== null) imports.push({ name: entry[1] ?? lastSegment(entry[2]), path: entry[2], line: j, alias: entry[1] });
      }
      taken.add(j);
      i = j;
    }
  }
  return { imports, taken };
}

function lastSegment(path) {
  const seg = path.split("/").pop();
  return /^v\d+$/.test(seg) ? path.split("/").slice(-2, -1)[0] : seg;
}

function assemble(unit) {
  const lines = bodyLines(unit.body);
  const first = unit.line + 1;
  const a = new Assembly();
  const { imports, taken } = goImports(lines);
  const paths = imports.map((i) => i.path);

  if (unit.kind === "file") {
    a.addBody(lines, first);
    return { assembly: a, imports: paths };
  }

  const prelude = unit.prelude ?? GO_PRELUDES.sdk;
  const own = new Set(imports.map((i) => i.name));
  const rest = lines.filter((_, i) => !taken.has(i)).join("\n");
  const packageLevel = /^(?:func|type)\s/m.test(rest);
  const declaredAtPackageLevel = new Set([...rest.matchAll(/^(?:var|const|func)\s+(\w+)/gm)].map((m) => m[1]));

  a.add("package main", "", "import (");
  for (const [name, path] of Object.entries(prelude.imports)) {
    if (own.has(name)) continue;
    a.add(name === lastSegment(path) ? `\t"${path}"` : `\t${name} "${path}"`);
    paths.push(path);
  }
  for (const imp of imports) a.addBody([`\t${imp.alias ? `${imp.alias} ` : ""}"${imp.path}"`], first + imp.line);
  a.add(")", "");
  for (const [name, type] of Object.entries(prelude.context)) {
    if (declaredAtPackageLevel.has(name)) continue;
    if (!new RegExp(`\\b${name}\\b`).test(rest)) continue;
    a.add(`var ${name} ${type}`);
  }
  if (packageLevel) {
    lines.forEach((line, i) => a.addBody([taken.has(i) ? "" : line], first + i));
  } else {
    a.add("func _() {");
    lines.forEach((line, i) => a.addBody([taken.has(i) ? "" : line], first + i));
    a.add("}");
  }
  return { assembly: a, imports: paths };
}
