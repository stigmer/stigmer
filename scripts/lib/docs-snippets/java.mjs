/**
 * The docs snippet gate's Java compiler: one `javac` run over every Java
 * fence, against the SDK's jar and its runtime classpath (the classpath
 * file `mvn dependency:build-classpath` writes, the jar found under
 * `sdk/java/target`).
 *
 * Each fence gets a package of its own, so two fences' classes never meet. A
 * whole program (a type declaration) keeps its body and gains only that
 * package line. A fragment gets the imports of the page's prelude, its
 * hidden setup and its own, hoisted above a class whose fields are the
 * gate's convention (the client) and the prelude's and setup's other lines;
 * its body goes inside a method of that class, or at class level when it
 * declares methods of its own at the left margin (an example that returns a
 * value is the method it belongs to).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Assembly, located } from "./assemble.mjs";
import { conventionFor } from "./preludes.mjs";

/**
 * @param {object[]} units the Java units
 * @param {{repoRoot: string, classpathFile?: string}} opts
 * @returns {{id: number, page: string, line: number, message: string}[]}
 */
export function checkJava(units, { repoRoot, classpathFile }) {
  if (classpathFile === undefined) {
    throw new Error("the Java check needs --java-classpath=<file from mvn dependency:build-classpath in sdk/java>");
  }
  const target = join(repoRoot, "sdk", "java", "target");
  const jar = readdirSync(target).find((f) => /^stigmer-sdk-.*\.jar$/.test(f) && !/-(sources|javadoc)\.jar$/.test(f));
  if (jar === undefined) throw new Error("no sdk/java/target/stigmer-sdk-*.jar: build the Java SDK first (mvn -q install -DskipTests in sdk/java)");
  const classpath = `${join(target, jar)}:${readFileSync(classpathFile, "utf8").trim()}`;

  const dir = mkdtempSync(join(tmpdir(), "docs-snippets-java-"));
  try {
    const files = new Map();
    for (const unit of units) {
      const { assembly, className } = assemble(unit);
      const pkgDir = join(dir, `s${unit.id}`);
      mkdirSync(pkgDir);
      const file = join(pkgDir, `${className}.java`);
      writeFileSync(file, assembly.text());
      files.set(file, { unit, assembly });
    }
    // javac stops before checking types when any file fails to parse, so a
    // run that reports errors is repeated without the files it named, until
    // a run reports none: every fence's errors are found, not just the first
    // phase's.
    const errors = [];
    let pending = [...files.keys()];
    while (pending.length > 0) {
      const out = javac(dir, classpath, pending);
      const found = parseJavac(out, files);
      // javac exited non-zero with nothing the gate can place on a page (a
      // bad classpath, a crash): the run is not a pass.
      if (found.length === 0 && out !== "") throw new Error(`javac failed with no error the snippet gate can place:\n${out}`);
      if (found.length === 0) break;
      errors.push(...found);
      const failed = new Set(found.map((e) => e.file));
      pending = pending.filter((f) => !failed.has(f));
    }
    return errors.map(({ file: _file, ...e }) => e);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function javac(dir, classpath, sources) {
  try {
    execFileSync("javac", ["-proc:none", "-Xmaxerrs", "100000", "-encoding", "UTF-8", "-d", join(dir, "out"), "-cp", classpath, ...sources], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return "";
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    if (out === "") throw err;
    return out;
  }
}

// javac reports "<file>:<line>: error: <message>", then the source line and
// a caret, then any detail lines ("symbol: ...", "location: ...").
function parseJavac(out, files) {
  const errors = [];
  const lines = out.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(.+\.java):(\d+): error: (.*)$/.exec(lines[i]);
    if (m === null) continue;
    const entry = files.get(m[1]);
    if (entry === undefined) continue;
    const detail = [];
    for (let j = i + 3; j < lines.length && /^\s+(symbol|location|required|found|reason)/.test(lines[j]); j++) detail.push(lines[j].trim());
    const message = [m[3], ...detail.filter((d) => d.startsWith("symbol"))].join(" ");
    errors.push({ file: m[1], ...located(entry.unit, entry.assembly, Number(m[2]), message) });
  }
  return errors;
}

const TYPE_DECLARATION = /^(?:public\s+|final\s+|abstract\s+)*(?:class|record|interface|enum)\s+(\w+)/m;
// A method declaration at the left margin: a type, a name, a parameter list
// and an opening brace, never a statement keyword.
const METHOD_AT_MARGIN = /^(?!(?:if|for|while|switch|try|catch|return|new|else|do|synchronized)\b)(?:(?:public|private|protected|static|final)\s+)*[A-Za-z_][\w<>[\],.?]*(?:<[^>]*>)?\s+\w+\s*\([^;]*\)\s*(?:throws\s+[\w.,\s]+)?\{\s*$/m;

function assemble(unit) {
  const a = new Assembly();
  a.add(`package s${unit.id};`);
  const all = [...unit.setup, ...unit.body];
  if (unit.kind === "file") {
    a.addSource(all.map((l) => (/^package\s+[\w.]+;/.test(l.text) ? { text: "", line: l.line } : l)));
    const text = all.map((l) => l.text).join("\n");
    const publicType = /^public\s+(?:final\s+|abstract\s+)*(?:class|record|interface|enum)\s+(\w+)/m.exec(text);
    return { assembly: a, className: publicType?.[1] ?? TYPE_DECLARATION.exec(text)?.[1] ?? "Snippet" };
  }
  const convention = conventionFor(unit.page, "java");
  const isImport = (l) => /^import\s+(?:static\s+)?[\w.*]+;\s*$/.test(l.text);
  a.add(...convention.imports);
  const preludeImports = unit.prelude.filter(isImport);
  a.addPrelude(preludeImports.map((l) => l.text), preludeImports.map((l) => l.line));
  a.addSource(unit.setup.filter(isImport));
  a.addSource(unit.body.filter(isImport));
  a.add("class Snippet {");
  for (const [name, type] of Object.entries(convention.context)) a.add(`  ${type} ${name};`);
  const preludeRest = unit.prelude.filter((l) => !isImport(l));
  a.addPrelude(preludeRest.map((l) => l.text), preludeRest.map((l) => l.line));
  a.addSource(unit.setup.filter((l) => !isImport(l)));
  const rest = unit.body.filter((l) => !isImport(l));
  const classLevel = METHOD_AT_MARGIN.test(rest.map((l) => l.text).join("\n"));
  if (!classLevel) a.add("  void snippet() throws Exception {");
  a.addSource(unit.body.map((l) => (isImport(l) ? { text: "", line: l.line } : l)));
  if (!classLevel) a.add("  }");
  a.add("}");
  return { assembly: a, className: "Snippet" };
}
