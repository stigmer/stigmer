/**
 * The docs snippet gate's Go compiler: assembles each Go fence into a file
 * of `package main` and type-checks it with the standard library's
 * `go/types` (the tool module beside this file), against export data
 * `go list -export` builds for the SDK module and the packages the fences
 * import.
 *
 * A whole program (a `package` clause) is checked as it stands. A fragment
 * gets one import block: the gate's convention (`context` and the SDK as
 * `stigmer`), the page's prelude, its hidden setup's and its own, a later
 * layer's import of a name or path replacing an earlier one's. Then the
 * convention's names (`client`, `ctx`) as package variables, only those it
 * uses and does not declare; the prelude's and the setup's other lines at
 * package level; and its body inside a function, unless the body declares
 * functions or types of its own at the left margin, when it stays at package
 * level.
 *
 * Only "declared and not used" is ignored (the tool says why), and an unused
 * import the convention or the prelude added: a fragment uses the part of
 * the prelude it needs, not all of it.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { Assembly, located } from "./assemble.mjs";
import { conventionFor } from "./preludes.mjs";

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
    const given = f.line !== 0 && (assembly.pageLine(f.line) === null || assembly.fromPrelude(f.line));
    if (given && /imported (?:as \w+ )?and not used/.test(f.message)) continue;
    errors.push(located(unit, assembly, f.line, f.message));
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
      imports.push({ name: single[1] ?? packageName(single[2]), path: single[2], line: i, alias: single[1] });
      taken.add(i);
      continue;
    }
    if (IMPORT_BLOCK_OPEN.test(lines[i])) {
      taken.add(i);
      let j = i + 1;
      for (; j < lines.length && lines[j].trim() !== ")"; j++) {
        taken.add(j);
        const entry = BLOCK_ENTRY.exec(lines[j]);
        if (entry !== null) imports.push({ name: entry[1] ?? packageName(entry[2]), path: entry[2], line: j, alias: entry[1] });
      }
      taken.add(j);
      i = j;
    }
  }
  return { imports, taken };
}

/** The name an unaliased import binds: the SDK's package is `stigmer`, a versioned proto package `<name>v1`. */
export function packageName(path) {
  if (path === "go.stigmer.ai/sdk") return "stigmer";
  const parts = path.split("/");
  const seg = parts.pop();
  return /^v\d+$/.test(seg) ? `${parts.pop()}${seg}` : seg;
}


function assemble(unit) {
  const a = new Assembly();
  const lines = (src) => src.map((l) => l.text);
  const body = goImports(lines(unit.body));
  const paths = body.imports.map((i) => i.path);

  if (unit.kind === "file") {
    const setup = goImports(lines(unit.setup));
    a.addSource([...unit.setup, ...unit.body]);
    return { assembly: a, imports: [...paths, ...setup.imports.map((i) => i.path)] };
  }

  const convention = conventionFor(unit.page, "go");
  const prelude = goImports(lines(unit.prelude));
  const setup = goImports(lines(unit.setup));
  // Each layer's imports, earliest first; a later layer's import of the same
  // name or path wins, so a fence that imports what the prelude does is not
  // a duplicate.
  const layers = [
    { from: "convention", imports: Object.entries(convention.imports).map(([name, path]) => ({ name, path, alias: name === packageName(path) ? undefined : name })) },
    { from: "prelude", src: unit.prelude, imports: prelude.imports },
    { from: "setup", src: unit.setup, imports: setup.imports },
    { from: "body", src: unit.body, imports: body.imports },
  ];
  const kept = [];
  for (const layer of layers) {
    for (const imp of layer.imports) {
      for (let i = kept.length - 1; i >= 0; i--) if (kept[i].imp.name === imp.name || kept[i].imp.path === imp.path) kept.splice(i, 1);
      kept.push({ layer, imp });
    }
  }
  a.add("package main", "", "import (");
  for (const { layer, imp } of kept) {
    const text = `\t${imp.alias ? `${imp.alias} ` : ""}"${imp.path}"`;
    if (layer.from === "convention") a.add(text);
    else if (layer.from === "prelude") a.addPrelude([text], [layer.src[imp.line].line]);
    else a.addSource([{ text, line: layer.src[imp.line].line }]);
    paths.push(imp.path);
  }
  a.add(")", "");

  const rest = (src, taken) => src.filter((_, i) => !taken.has(i));
  const preludeRest = rest(unit.prelude, prelude.taken);
  const setupRest = rest(unit.setup, setup.taken);
  const bodyRest = rest(unit.body, body.taken);
  const packageLevelText = [...preludeRest, ...setupRest, ...(/^(?:func|type)\s/m.test(lines(bodyRest).join("\n")) ? bodyRest : [])];
  const declaredAtPackageLevel = new Set([...lines(packageLevelText).join("\n").matchAll(/^(?:var|const|func)\s+(\w+)/gm)].map((m) => m[1]));
  const used = lines([...preludeRest, ...setupRest, ...bodyRest]).join("\n");
  for (const [name, type] of Object.entries(convention.context)) {
    if (declaredAtPackageLevel.has(name)) continue;
    if (!new RegExp(`\\b${name}\\b`).test(used)) continue;
    a.add(`var ${name} ${type}`);
  }
  a.addPrelude(lines(preludeRest), preludeRest.map((l) => l.line));
  a.addSource(setupRest);
  const blank = (src, taken) => src.map((l, i) => (taken.has(i) ? { text: "", line: l.line } : l));
  if (/^(?:func|type)\s/m.test(lines(bodyRest).join("\n"))) {
    a.addSource(blank(unit.body, body.taken));
  } else {
    a.add("func _() {");
    a.addSource(blank(unit.body, body.taken));
    a.add("}");
  }
  return { assembly: a, imports: paths };
}
