/**
 * The docs snippet gate's Java compiler: one `javac` run over every Java
 * fence, against the SDK's jar and its runtime classpath (the classpath
 * file `mvn dependency:build-classpath` writes, the jar found under
 * `sdk/java/target`).
 *
 * Each fence gets a package of its own, so two fences' classes never meet. A
 * whole program (a type declaration) keeps its body and gains only that
 * package line. A fragment gets its prelude's imports, its own imports
 * hoisted above, and goes inside a method of a class whose fields are the
 * prelude's context names; a fragment that declares methods of its own at
 * the left margin is placed at class level instead.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Assembly, bodyLines } from "./assemble.mjs";
import { JAVA_PRELUDES } from "./preludes.mjs";

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
  const protoPackages = stubPackages(classpath);

  const dir = mkdtempSync(join(tmpdir(), "docs-snippets-java-"));
  try {
    const files = new Map();
    for (const unit of units) {
      const { assembly, className } = assemble(unit, protoPackages);
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
      const found = parseJavac(javac(dir, classpath, pending), files);
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
    const pageLine = entry.assembly.pageLine(Number(m[2]));
    const message = [m[3], ...detail.filter((d) => d.startsWith("symbol"))].join(" ");
    errors.push({
      file: m[1],
      id: entry.unit.id,
      page: entry.unit.page,
      line: pageLine ?? entry.unit.line,
      message: pageLine === null ? `${message} (in the gate's prelude for this fence)` : message,
    });
  }
  return errors;
}

const TYPE_DECLARATION = /^(?:public\s+|final\s+|abstract\s+)*(?:class|record|interface|enum)\s+(\w+)/m;
// A method declaration at the left margin: a type, a name, a parameter list
// and an opening brace, never a statement keyword.
const METHOD_AT_MARGIN = /^(?!(?:if|for|while|switch|try|catch|return|new|else|do|synchronized)\b)(?:(?:public|private|protected|static|final)\s+)*[A-Za-z_][\w<>[\],.?]*(?:<[^>]*>)?\s+\w+\s*\([^;]*\)\s*(?:throws\s+[\w.,\s]+)?\{\s*$/m;

// Every package of the generated stubs jar on the classpath, so the prelude's
// `ai.stigmer.**` names them all: a fragment's resource types resolve without
// a list kept by hand.
function stubPackages(classpath) {
  const stubs = classpath.split(":").find((p) => /stigmer-apis-[^/]*\.jar$/.test(p));
  if (stubs === undefined) throw new Error("the Java classpath holds no stigmer-apis jar (the generated stubs)");
  const listing = execFileSync("jar", ["tf", stubs], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const packages = new Set();
  for (const entry of listing.split("\n")) {
    if (!entry.endsWith(".class") || entry.includes("$")) continue;
    packages.add(entry.slice(0, entry.lastIndexOf("/")).replaceAll("/", "."));
  }
  return [...packages].sort();
}

function assemble(unit, protoPackages) {
  const lines = bodyLines(unit.body);
  const first = unit.line + 1;
  const a = new Assembly();
  a.add(`package s${unit.id};`);
  if (unit.kind === "file") {
    const pkgLine = lines.findIndex((l) => /^package\s+[\w.]+;/.test(l));
    lines.forEach((line, i) => a.addBody([i === pkgLine ? "" : line], first + i));
    const publicType = /^public\s+(?:final\s+|abstract\s+)*(?:class|record|interface|enum)\s+(\w+)/m.exec(unit.body);
    return { assembly: a, className: publicType?.[1] ?? TYPE_DECLARATION.exec(unit.body)?.[1] ?? "Snippet" };
  }
  const prelude = unit.prelude ?? JAVA_PRELUDES.sdk;
  const imports = new Set(lines.flatMap((l, i) => (/^import\s+[\w.*]+;\s*$/.test(l) ? [i] : [])));
  for (const line of prelude.imports) {
    if (line === "import ai.stigmer.**;") a.add(...protoPackages.map((p) => `import ${p}.*;`));
    else a.add(line);
  }
  lines.forEach((line, i) => {
    if (imports.has(i)) a.addBody([line], first + i);
  });
  const rest = lines.filter((_, i) => !imports.has(i)).join("\n");
  a.add("class Snippet {");
  for (const [name, type] of Object.entries(prelude.context)) a.add(`  ${type} ${name};`);
  const classLevel = METHOD_AT_MARGIN.test(rest);
  if (!classLevel) a.add("  void snippet() throws Exception {");
  lines.forEach((line, i) => a.addBody([imports.has(i) ? "" : line], first + i));
  if (!classLevel) a.add("  }");
  a.add("}");
  return { assembly: a, className: "Snippet" };
}
