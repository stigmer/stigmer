/**
 * The format-on-edit plugin: its hook script against real files in a
 * temporary workspace, and its folder through the install's own reader.
 *
 * Formatters are fakes: small executable scripts (run by this Node, through
 * an absolute `#!`) placed in a project's `node_modules/.bin`, `.venv/bin`,
 * `vendor/bin` or a temporary `PATH`, that record their working directory
 * and arguments and rewrite the file deterministically, fail, hang or leave
 * it alone. `PATH` is only the fakes' directory, so a formatter installed on
 * the machine never runs.
 *
 * Pins: each evidence rule (an npm dependency with its binary, hoisted or
 * not; a Biome config in an entry below the root, run from that entry; Ruff's
 * three config spellings and its `.venv`; `.clang-format`; `mix.exs`; Pint's
 * `composer.json`; a one-style binary on `PATH`; rustfmt's edition, own or
 * inherited); table order and the fall-through to the next formatter after a
 * failure; a call that formats nothing (no evidence, no binary, an unknown
 * extension, a file outside the workspace or a symlink leaving it, a failed
 * edit's or write's result text, a deleted file) prints nothing, exits 0 and
 * leaves the file; every formatter failing or hanging prints nothing and
 * exits 1 with a stderr line naming the formatters and no path; a change
 * prints Claude Code's `additionalContext` with the workspace-relative path
 * and the changed line span; an unchanged file prints nothing. The child
 * process cases drive the script as a hook runs it, stdin to exit code, and
 * are the only cases of its entry lines. The reader takes the folder as an
 * open-format plugin with no warnings and exactly one Claude Code
 * `PostToolUse` group on `Write|Edit` running the script in exec form.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { preparePluginFromTree } from "@stigmer/plugin-package/client";
import { afterEach, describe, expect, it } from "vitest";

import { cargoEdition, changedLines, FORMATTERS, formatAfterEdit } from "../format-on-edit/hooks/format.mjs";
import { listDirectory } from "../scripts/lib/candidates.js";
import { CATALOGUE_ROOT } from "../scripts/lib/catalogue-tree.js";

const SCRIPT = fileURLToPath(new URL("../format-on-edit/hooks/format.mjs", import.meta.url));
const UNFORMATTED = "export function add(a, b) { return a + b; }\n";
const FORMATTED = "export function add(a, b) {\n  return a + b;\n}\n";

type Behaviour = "rewrite" | "fail" | "hang" | "noop";

interface Call {
  readonly name: string;
  readonly cwd: string;
  readonly args: string[];
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A fresh workspace (real path) with an empty `bin` for `PATH`, outside it. */
function workspace(): { root: string; bin: string; env: Record<string, string> } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "format-on-edit-")));
  roots.push(base);
  const root = join(base, "ws");
  const bin = join(base, "bin");
  mkdirSync(root);
  mkdirSync(bin);
  return { root, bin, env: { CLAUDE_PROJECT_DIR: root, PATH: bin } };
}

/** Write `content` at `root/path`, creating folders. */
function put(root: string, path: string, content: string): string {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

/** A fake formatter at `path`: it logs its call to `log` and acts on its last argument. */
function fake(path: string, log: string, behaviour: Behaviour = "rewrite"): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ name: path.basename(process.argv[1]), cwd: process.cwd(), args }) + "\\n");
const behaviour = ${JSON.stringify(behaviour)};
if (behaviour === "fail") process.exit(2);
if (behaviour === "hang") setTimeout(() => {}, 60000);
if (behaviour === "rewrite") {
  const file = args[args.length - 1];
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll("{ ", "{\\n  ").replaceAll(" }", "\\n}"));
}
`;
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function calls(log: string): Call[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Call);
}

/** Claude Code's PostToolUse input for a landed write or edit of `file`. */
function hookInput(file: string, output = `Successfully replaced 1 occurrence(s) in '/${file}'`): string {
  return JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: file },
    tool_response: { filePath: file, output },
  });
}

function notice(title: string, path: string, lines: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `${title} reformatted ${path} after this change (${lines} now differ from what you wrote). Read those lines again before quoting them in another edit.`,
    },
  });
}

const SILENT = { stdout: "", stderr: "", exitCode: 0 };

describe("the formatters the project declares", () => {
  it("runs Prettier from the project's node_modules when a package.json depends on it, in that package's folder", () => {
    const { root, env } = workspace();
    const log = join(root, "..", "calls");
    put(root, "package.json", JSON.stringify({ devDependencies: { prettier: "^3.0.0" } }));
    fake(join(root, "node_modules", ".bin", "prettier"), log);
    const file = put(root, "src/app.ts", UNFORMATTED);

    expect(formatAfterEdit(hookInput(file), env)).toEqual({ stdout: notice("Prettier", "src/app.ts", "lines 1-3"), stderr: "", exitCode: 0 });
    expect(readFileSync(file, "utf8")).toBe(FORMATTED);
    expect(calls(log)).toEqual([{ name: "prettier", cwd: root, args: ["--write", file] }]);
  });

  it("finds a hoisted binary above the package that depends on it, and runs in that package", () => {
    const { root, env } = workspace();
    const log = join(root, "..", "calls");
    put(root, "packages/web/package.json", JSON.stringify({ dependencies: { prettier: "3" } }));
    fake(join(root, "node_modules", ".bin", "prettier"), log);
    const file = put(root, "packages/web/src/app.ts", UNFORMATTED);

    expect(formatAfterEdit(hookInput(file), env).stdout).toBe(notice("Prettier", "packages/web/src/app.ts", "lines 1-3"));
    expect(calls(log)).toEqual([{ name: "prettier", cwd: join(root, "packages", "web"), args: ["--write", file] }]);
  });

  it("never runs Prettier for a project that does not depend on it, though the binary is there", () => {
    const { root, env } = workspace();
    const log = join(root, "..", "calls");
    put(root, "package.json", JSON.stringify({ devDependencies: { typescript: "5" } }));
    fake(join(root, "node_modules", ".bin", "prettier"), log);
    const file = put(root, "src/app.ts", UNFORMATTED);

    expect(formatAfterEdit(hookInput(file), env)).toEqual(SILENT);
    expect(readFileSync(file, "utf8")).toBe(UNFORMATTED);
    expect(calls(log)).toEqual([]);
  });

  it("runs oxfmt before Prettier when the project depends on both", () => {
    const { root, env } = workspace();
    const log = join(root, "..", "calls");
    put(root, "package.json", JSON.stringify({ devDependencies: { prettier: "3", oxfmt: "1" } }));
    fake(join(root, "node_modules", ".bin", "prettier"), log);
    fake(join(root, "node_modules", ".bin", "oxfmt"), log);
    const file = put(root, "app.js", UNFORMATTED);

    expect(formatAfterEdit(hookInput(file), env).stdout).toBe(notice("oxfmt", "app.js", "lines 1-3"));
    expect(calls(log)).toEqual([{ name: "oxfmt", cwd: root, args: [file] }]);
  });

  it("runs Biome from the entry whose biome.json it found, below the workspace root", () => {
    const { root, env } = workspace();
    const log = join(root, "..", "calls");
    put(root, "app/biome.json", "{}");
    fake(join(root, "node_modules", ".bin", "biome"), log);
    const file = put(root, "app/src/main.ts", UNFORMATTED);

    expect(formatAfterEdit(hookInput(file), env).stdout).toBe(notice("Biome", "app/src/main.ts", "lines 1-3"));
    expect(calls(log)).toEqual([{ name: "biome", cwd: join(root, "app"), args: ["format", "--write", file] }]);
  });

  it("gives Prettier the file when the project declares both it and Biome, and Biome when Prettier fails", () => {
    const { root, env } = workspace();
    const log = join(root, "..", "calls");
    put(root, "package.json", JSON.stringify({ devDependencies: { prettier: "3" } }));
    put(root, "biome.jsonc", "{}");
    fake(join(root, "node_modules", ".bin", "prettier"), log);
    fake(join(root, "node_modules", ".bin", "biome"), log);
    const file = put(root, "a.ts", UNFORMATTED);
    expect(formatAfterEdit(hookInput(file), env).stdout).toBe(notice("Prettier", "a.ts", "lines 1-3"));
    expect(calls(log).map((c) => c.name)).toEqual(["prettier"]);

    fake(join(root, "node_modules", ".bin", "prettier"), log, "fail");
    writeFileSync(file, UNFORMATTED);
    expect(formatAfterEdit(hookInput(file), env).stdout).toBe(notice("Biome", "a.ts", "lines 1-3"));
    expect(calls(log).map((c) => c.name)).toEqual(["prettier", "prettier", "biome"]);
  });

  it("runs Ruff on a [tool.ruff] pyproject from the project's .venv, and on a ruff.toml from PATH", () => {
    const { root, bin, env } = workspace();
    const log = join(root, "..", "calls");
    put(root, "svc/pyproject.toml", '[project]\nname = "svc"\n\n[tool.ruff]\nline-length = 100\n');
    fake(join(root, "svc", ".venv", "bin", "ruff"), log);
    const first = put(root, "svc/app.py", "def f(): { return 1 }\n");
    expect(formatAfterEdit(hookInput(first), env).stdout).toBe(notice("Ruff", "svc/app.py", "lines 1-3"));
    expect(calls(log)).toEqual([{ name: "ruff", cwd: join(root, "svc"), args: ["format", first] }]);

    put(root, "tool/.ruff.toml", "");
    fake(join(bin, "ruff"), log);
    const second = put(root, "tool/run.pyi", "x = { 1 }\n");
    expect(formatAfterEdit(hookInput(second), env).stdout).toBe(notice("Ruff", "tool/run.pyi", "lines 1-3"));
    expect(calls(log).at(-1)).toEqual({ name: "ruff", cwd: join(root, "tool"), args: ["format", second] });

    put(root, "lib/ruff.toml", "");
    const third = put(root, "lib/x.py", "y = { 2 }\n");
    expect(formatAfterEdit(hookInput(third), env).exitCode).toBe(0);
    expect(calls(log).at(-1)?.cwd).toBe(join(root, "lib"));
  });

  it("never runs Ruff for a pyproject that does not configure it, though ruff is on PATH", () => {
    const { root, bin, env } = workspace();
    const log = join(root, "..", "calls");
    put(root, "pyproject.toml", '[project]\nname = "x"\ndependencies = ["ruff"]\n');
    fake(join(bin, "ruff"), log);
    const file = put(root, "app.py", "x = { 1 }\n");
    expect(formatAfterEdit(hookInput(file), env)).toEqual(SILENT);
    expect(calls(log)).toEqual([]);
  });

  it("runs clang-format and ocamlformat only under their config files", () => {
    const { root, bin, env } = workspace();
    const log = join(root, "..", "calls");
    fake(join(bin, "clang-format"), log);
    fake(join(bin, "ocamlformat"), log);
    const bare = put(root, "loose/main.c", "int main() { return 0; }\n");
    const ml = put(root, "loose/a.ml", "let x = { y }\n");
    expect(formatAfterEdit(hookInput(bare), env)).toEqual(SILENT);
    expect(formatAfterEdit(hookInput(ml), env)).toEqual(SILENT);

    put(root, "native/.clang-format", "BasedOnStyle: LLVM\n");
    const c = put(root, "native/src/main.cpp", "int main() { return 0; }\n");
    expect(formatAfterEdit(hookInput(c), env).stdout).toBe(notice("clang-format", "native/src/main.cpp", "lines 1-3"));
    put(root, ".ocamlformat", "");
    expect(formatAfterEdit(hookInput(ml), env).stdout).toBe(notice("ocamlformat", "loose/a.ml", "lines 1-3"));
    expect(calls(log)).toEqual([
      { name: "clang-format", cwd: join(root, "native"), args: ["-i", c] },
      { name: "ocamlformat", cwd: root, args: ["-i", ml] },
    ]);
  });

  it("runs mix format only in a Mix project, from the folder holding mix.exs", () => {
    const { root, bin, env } = workspace();
    const log = join(root, "..", "calls");
    fake(join(bin, "mix"), log);
    const loose = put(root, "scripts/x.exs", "x = { 1 }\n");
    expect(formatAfterEdit(hookInput(loose), env)).toEqual(SILENT);

    put(root, "apps/core/mix.exs", "");
    const file = put(root, "apps/core/lib/core.ex", "x = { 1 }\n");
    expect(formatAfterEdit(hookInput(file), env).stdout).toBe(notice("mix format", "apps/core/lib/core.ex", "lines 1-3"));
    expect(calls(log)).toEqual([{ name: "mix", cwd: join(root, "apps", "core"), args: ["format", file] }]);
  });

  it("runs Pint from vendor/bin in a project whose composer.json requires it", () => {
    const { root, env } = workspace();
    const log = join(root, "..", "calls");
    put(root, "composer.json", JSON.stringify({ require: { php: "^8.2" } }));
    fake(join(root, "vendor", "bin", "pint"), log);
    const file = put(root, "app/User.php", "<?php function f() { return 1; }\n");
    expect(formatAfterEdit(hookInput(file), env)).toEqual(SILENT);

    put(root, "composer.json", JSON.stringify({ "require-dev": { "laravel/pint": "^1.0" } }));
    expect(formatAfterEdit(hookInput(file), env).stdout).toBe(notice("Pint", "app/User.php", "lines 1-3"));
    expect(calls(log)).toEqual([{ name: "pint", cwd: root, args: [file] }]);
  });

  it("runs a one-style formatter whenever its binary is on PATH, in the file's folder", () => {
    const { root, bin, env } = workspace();
    const log = join(root, "..", "calls");
    const file = put(root, "cmd/main.go", "func main() { run() }\n");
    expect(formatAfterEdit(hookInput(file), env)).toEqual(SILENT);

    fake(join(bin, "gofmt"), log);
    fake(join(bin, "terraform"), log);
    expect(formatAfterEdit(hookInput(file), env).stdout).toBe(notice("gofmt", "cmd/main.go", "lines 1-3"));
    const tf = put(root, "infra/main.tf", "x = { a }\n");
    expect(formatAfterEdit(hookInput(tf), env).stdout).toBe(notice("terraform fmt", "infra/main.tf", "lines 1-3"));
    expect(calls(log)).toEqual([
      { name: "gofmt", cwd: join(root, "cmd"), args: ["-w", file] },
      { name: "terraform", cwd: join(root, "infra"), args: ["fmt", tf] },
    ]);
  });

  it("passes rustfmt the crate's edition, its own or the workspace's, and none when nothing declares one", () => {
    const { root, bin, env } = workspace();
    const log = join(root, "..", "calls");
    fake(join(bin, "rustfmt"), log);
    put(root, "Cargo.toml", '[workspace]\nmembers = ["a", "b"]\n\n[workspace.package]\nedition = "2021"\n');
    put(root, "a/Cargo.toml", '[package]\nname = "a"\nedition = "2024"\n');
    put(root, "b/Cargo.toml", '[package]\nname = "b"\nedition.workspace = true\n');
    const own = put(root, "a/src/lib.rs", "fn f() { g() }\n");
    const inherited = put(root, "b/src/lib.rs", "fn f() { g() }\n");
    const loose = put(root, "tools/x.rs", "fn f() { g() }\n");
    rmSync(join(root, "Cargo.toml"));
    expect(formatAfterEdit(hookInput(loose), env).exitCode).toBe(0);
    put(root, "Cargo.toml", '[workspace]\nmembers = ["a", "b"]\n\n[workspace.package]\nedition = "2021"\n');
    formatAfterEdit(hookInput(own), env);
    formatAfterEdit(hookInput(inherited), env);

    expect(calls(log)).toEqual([
      { name: "rustfmt", cwd: join(root, "tools"), args: [loose] },
      { name: "rustfmt", cwd: join(root, "a"), args: ["--edition", "2024", own] },
      { name: "rustfmt", cwd: join(root, "b"), args: ["--edition", "2021", inherited] },
    ]);
  });

  it("keeps the table in OpenCode's order, narrowed to the formatters a project declares", () => {
    expect(FORMATTERS.map((f) => f.name)).toEqual([
      "gofmt",
      "mix",
      "oxfmt",
      "prettier",
      "biome",
      "zig",
      "clang-format",
      "ruff",
      "dart",
      "ocamlformat",
      "terraform",
      "gleam",
      "rustfmt",
      "pint",
    ]);
  });
});

describe("calls that format nothing", () => {
  function prettierProject(): { root: string; env: Record<string, string>; log: string; file: string } {
    const { root, env } = workspace();
    const log = join(root, "..", "calls");
    put(root, "package.json", JSON.stringify({ devDependencies: { prettier: "3" } }));
    fake(join(root, "node_modules", ".bin", "prettier"), log);
    return { root, env, log, file: put(root, "src/app.ts", UNFORMATTED) };
  }

  it("leaves a file alone after a failed edit or write", () => {
    const { env, log, file } = prettierProject();
    for (const output of [
      "Error: String not found in file: 'return a+b'",
      "Error: String 'a' has multiple occurrences (appears 2 times) in file.",
      `Cannot write to ${file} because it is a symlink. Symlinks are not allowed.`,
      `Failed to write to ${file}: permission denied`,
    ]) {
      expect(formatAfterEdit(hookInput(file, output), env), output).toEqual(SILENT);
    }
    expect(readFileSync(file, "utf8")).toBe(UNFORMATTED);
    expect(calls(log)).toEqual([]);
  });

  it("formats a landed call whose result carries no output text", () => {
    const { env, file } = prettierProject();
    const input = JSON.stringify({ tool_input: { file_path: file }, tool_response: { filePath: file } });
    expect(formatAfterEdit(input, env).exitCode).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(FORMATTED);
  });

  it("leaves a file outside the workspace, or reached through a symlink leaving it, alone", () => {
    const { root, env, log } = prettierProject();
    const outside = put(join(root, ".."), "outside/app.ts", UNFORMATTED);
    symlinkSync(outside, join(root, "src", "link.ts"));
    expect(formatAfterEdit(hookInput(outside), env)).toEqual(SILENT);
    expect(formatAfterEdit(hookInput(join(root, "src", "link.ts")), env)).toEqual(SILENT);
    expect(readFileSync(outside, "utf8")).toBe(UNFORMATTED);
    expect(calls(log)).toEqual([]);
  });

  it("formats nothing for an unknown extension, a deleted file, no path, or no workspace", () => {
    const { root, env, log } = prettierProject();
    const notes = put(root, "notes.xyz", UNFORMATTED);
    expect(formatAfterEdit(hookInput(notes), env)).toEqual(SILENT);
    expect(formatAfterEdit(hookInput(join(root, "gone.ts")), env)).toEqual(SILENT);
    expect(formatAfterEdit(JSON.stringify({ tool_input: {} }), env)).toEqual(SILENT);
    expect(formatAfterEdit(hookInput(join(root, "src", "app.ts")), { PATH: env.PATH ?? "" })).toEqual(SILENT);
    expect(formatAfterEdit(hookInput(join(root, "src", "app.ts")), { ...env, CLAUDE_PROJECT_DIR: join(root, "missing") })).toEqual(SILENT);
    expect(calls(log)).toEqual([]);
  });

  it("prints nothing when the formatter leaves the file as it was", () => {
    const { root, env, log } = prettierProject();
    fake(join(root, "node_modules", ".bin", "prettier"), log, "noop");
    const file = put(root, "done.ts", FORMATTED);
    expect(formatAfterEdit(hookInput(file), env)).toEqual(SILENT);
    expect(calls(log).map((c) => c.name)).toEqual(["prettier"]);
  });

  it("refuses input that is not the hook's JSON", () => {
    const { env } = workspace();
    for (const input of ["", "not json", "[]", "null"]) {
      expect(formatAfterEdit(input, env)).toEqual({ stdout: "", stderr: "format-on-edit: unreadable hook input\n", exitCode: 1 });
    }
  });
});

describe("formatters that fail", () => {
  it("prints nothing and exits 1 naming each formatter, never the file, when every one fails", () => {
    const { root, env } = workspace();
    const log = join(root, "..", "calls");
    put(root, "package.json", JSON.stringify({ devDependencies: { prettier: "3" } }));
    put(root, "biome.json", "{}");
    fake(join(root, "node_modules", ".bin", "prettier"), log, "fail");
    fake(join(root, "node_modules", ".bin", "biome"), log, "fail");
    const file = put(root, "secret-plans.ts", UNFORMATTED);

    const answer = formatAfterEdit(hookInput(file), env);
    expect(answer).toEqual({ stdout: "", stderr: "format-on-edit: prettier exited 2; biome exited 2\n", exitCode: 1 });
    expect(answer.stderr).not.toContain("secret-plans");
    expect(readFileSync(file, "utf8")).toBe(UNFORMATTED);
  });

  it("kills a formatter that runs past its bound", () => {
    const { root, env } = workspace();
    const log = join(root, "..", "calls");
    put(root, "package.json", JSON.stringify({ devDependencies: { prettier: "3" } }));
    fake(join(root, "node_modules", ".bin", "prettier"), log, "hang");
    const file = put(root, "a.ts", UNFORMATTED);

    const started = Date.now();
    expect(formatAfterEdit(hookInput(file), env, { timeoutMs: 300 })).toEqual({
      stdout: "",
      stderr: "format-on-edit: prettier timed out after 300 ms\n",
      exitCode: 1,
    });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("names a formatter that could not start", () => {
    const { root, env } = workspace();
    put(root, "package.json", JSON.stringify({ devDependencies: { prettier: "3" } }));
    const bin = join(root, "node_modules", ".bin", "prettier");
    mkdirSync(dirname(bin), { recursive: true });
    writeFileSync(bin, "#!/nonexistent/interpreter\n");
    chmodSync(bin, 0o755);
    const file = put(root, "a.ts", UNFORMATTED);
    expect(formatAfterEdit(hookInput(file), env).stderr).toBe("format-on-edit: prettier did not start (ENOENT)\n");
  });

  it("names a formatter killed by a signal", () => {
    const { root, env } = workspace();
    put(root, "package.json", JSON.stringify({ devDependencies: { prettier: "3" } }));
    const bin = join(root, "node_modules", ".bin", "prettier");
    mkdirSync(dirname(bin), { recursive: true });
    writeFileSync(bin, `#!${process.execPath}\nprocess.kill(process.pid, "SIGTERM");\n`);
    chmodSync(bin, 0o755);
    const file = put(root, "a.ts", UNFORMATTED);
    expect(formatAfterEdit(hookInput(file), env).stderr).toBe("format-on-edit: prettier was killed by SIGTERM\n");
  });
});

describe("the changed line span", () => {
  it("names the first and last line that differ, on the formatted side", () => {
    expect(changedLines("a\nb\nc\n", "a\nB\nc\n")).toEqual({ first: 2, last: 2 });
    expect(changedLines("a\nb c\nd\n", "a\nb\nc\nd\n")).toEqual({ first: 2, last: 3 });
    expect(changedLines("a\n\n\nb\n", "a\n\nb\n"), "a removal names the line now in its place").toEqual({ first: 3, last: 3 });
    expect(changedLines("a\nb", "a\nb\n"), "a final newline added").toEqual({ first: 3, last: 3 });
    expect(changedLines("a\nb\n\n", "a\nb\n"), "a trailing blank line removed").toEqual({ first: 3, last: 3 });
  });

  it("reads a Cargo.toml's literal edition from [package] or [workspace.package] only", () => {
    expect(cargoEdition('[package]\nname = "x"\nedition = "2021"\n')).toBe("2021");
    expect(cargoEdition("[workspace.package]\r\nedition = '2024'\r\n")).toBe("2024");
    expect(cargoEdition('[package]\nedition.workspace = true\n[dependencies]\nedition = "9"\n')).toBeUndefined();
    expect(cargoEdition("")).toBeUndefined();
  });
});

describe("the script as a hook runs it", () => {
  function run(stdin: string, env: Record<string, string>): { stdout: string; stderr: string; status: number | null } {
    const result = spawnSync(process.execPath, [SCRIPT], { input: stdin, env, encoding: "utf8" });
    return { stdout: result.stdout, stderr: result.stderr, status: result.status };
  }

  it("reads stdin, answers on stdout and exits 0 after formatting", () => {
    const { root, env } = workspace();
    put(root, "package.json", JSON.stringify({ devDependencies: { prettier: "3" } }));
    fake(join(root, "node_modules", ".bin", "prettier"), join(root, "..", "calls"));
    const file = put(root, "src/app.ts", UNFORMATTED);

    expect(run(hookInput(file), env)).toEqual({ stdout: notice("Prettier", "src/app.ts", "lines 1-3"), stderr: "", status: 0 });
    expect(readFileSync(file, "utf8")).toBe(FORMATTED);
  });

  it("exits 1 with its stderr line when the formatter fails", () => {
    const { root, env } = workspace();
    put(root, "package.json", JSON.stringify({ devDependencies: { prettier: "3" } }));
    fake(join(root, "node_modules", ".bin", "prettier"), join(root, "..", "calls"), "fail");
    const file = put(root, "src/app.ts", UNFORMATTED);

    expect(run(hookInput(file), env)).toEqual({ stdout: "", stderr: "format-on-edit: prettier exited 2\n", status: 1 });
  });
});

describe("the plugin as Stigmer installs it", () => {
  it("reads as an open-format plugin with one Claude Code PostToolUse hook on Write|Edit, in exec form", async () => {
    const prepared = await preparePluginFromTree(listDirectory(join(CATALOGUE_ROOT, "format-on-edit")).candidates, { respectGitignore: true });
    if (!prepared.ok) throw new Error(`format-on-edit does not install: ${JSON.stringify(prepared)}`);
    const { plugin, warnings } = prepared.prepared;
    expect(warnings).toEqual([]);
    expect(plugin.name).toBe("format-on-edit");
    expect(plugin.dialect).toBe("agent-plugins");
    expect(plugin.hooks).toEqual({
      format: "claude-code",
      groups: [
        {
          event: "PostToolUse",
          matcher: "Write|Edit",
          handlers: [{ command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/hooks/format.mjs"], timeoutSeconds: 30, failClosed: false }],
        },
      ],
    });
  });
});
