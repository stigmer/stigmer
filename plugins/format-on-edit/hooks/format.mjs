// @ts-check
/**
 * The format-on-edit hook: after a file tool writes or edits a file, run the
 * project's own formatter on it, and tell the agent which lines moved.
 *
 * Claude Code runs it as a `PostToolUse` hook on `Write|Edit` (exec form,
 * `node <this file>`, so no shell is needed); Stigmer runs the same hook on
 * both its engines. It reads the hook's JSON on stdin: `tool_input.file_path`
 * (absolute) and `tool_response.output`, the tool's own result text, and the
 * environment's `CLAUDE_PROJECT_DIR`, the workspace root.
 *
 *  1. A call that did not land formats nothing. A failed native edit reaches
 *     PostToolUse as a plain result text, not as an error (deepagents returns
 *     the failure as the tool's output), so the text decides: deepagents'
 *     file-tool failures open with `Error`, `Cannot write` or
 *     `Failed to write`. A missing `output` counts as landed; the file's own
 *     bytes decide below. A missing or deleted file is nothing to format.
 *  2. Only a file whose real path lies under the workspace root is formatted,
 *     and every walk for the project's evidence stops at that root.
 *  3. The file's formatters are the entries of {@link FORMATTERS} whose
 *     extensions match and whose evidence holds, in table order (OpenCode's,
 *     anomalyco/opencode 37d973754b, `core/src/formatter/builtins.ts`). A
 *     canonical one-style formatter runs when its binary is on `PATH`; a
 *     configurable one only when the project says it uses it (a dependency in
 *     `package.json`, a config file), with its binary from the project's own
 *     `node_modules/.bin`, `.venv/bin` or `vendor/bin`, else `PATH` where the
 *     entry says so. Nothing is downloaded or installed. A formatter runs in
 *     the directory its evidence was found in, because Biome, Mix and others
 *     read their configuration from where they run; one with no evidence
 *     file runs in the file's own directory.
 *  4. They are tried in order until one exits 0: argv, no shell, the hook's
 *     own environment, stdin closed, output discarded, each killed after
 *     {@link FORMATTER_TIMEOUT_MS} (the hook's own timeout stops the whole
 *     process group as a backstop).
 *  5. When the file's bytes changed, the hook answers with Claude Code's
 *     `additionalContext`: one line naming the formatter, the file relative to
 *     the workspace root (the one spelling both engines read) and the lines
 *     that now differ from what the agent wrote, so its next edit re-reads
 *     them instead of quoting stale text. No formatter for the file is not a
 *     failure: nothing is printed and the exit is 0. When every matching
 *     formatter failed, nothing is printed, so the call reads exactly as it
 *     would without the hook, and the exit is 1 with one stderr line naming
 *     the formatters and how they ended, never the file: the runner logs a
 *     failed hook's stderr, and a hosted log must not carry a person's file
 *     names.
 *
 * Node built-ins only, so it runs on whatever Node the host has. The pieces
 * are exported for the catalogue's tests (`plugins/__tests__/format-on-edit.test.ts`).
 */

import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** How long one formatter may run before the hook kills it. */
export const FORMATTER_TIMEOUT_MS = 20_000;

/** The result texts of a file-tool call that did not land (deepagents' failure texts). */
const FAILED_RESULT = /^(?:Error\b|Cannot write\b|Failed to write\b)/;

/** What prefixes every line the hook writes to stderr. */
const LOG_PREFIX = "format-on-edit:";

/** @typedef {Readonly<Record<string, string | undefined>>} Env */

/**
 * A formatter ready to run on one file.
 * @typedef {object} Invocation
 * @property {string} command the binary's absolute path
 * @property {readonly string[]} args its arguments, the file last
 * @property {string} cwd where it runs
 */

/**
 * One formatter the hook knows.
 * @typedef {object} Formatter
 * @property {string} name the name a log line uses
 * @property {string} title the name the agent is told
 * @property {readonly string[]} extensions the file extensions it formats, case-sensitive
 * @property {(file: string, root: string, env: Env) => Invocation | undefined} resolve how to run it on `file`, or `undefined` when the project gives no evidence or the binary is missing
 */

/** @typedef {{ readonly stdout: string, readonly stderr: string, readonly exitCode: number }} HookAnswer */

const JS_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
const WEB_EXTENSIONS = [
  ...JS_EXTENSIONS,
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".vue",
  ".svelte",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".md",
  ".mdx",
  ".graphql",
  ".gql",
];

/**
 * The formatters, in the order a file's matches are tried. A project that
 * lists both Prettier and Biome gets Prettier, as on OpenCode.
 * @type {readonly Formatter[]}
 */
export const FORMATTERS = [
  canonical("gofmt", "gofmt", [".go"], ["-w"]),
  {
    name: "mix",
    title: "mix format",
    extensions: [".ex", ".exs", ".eex", ".heex", ".leex", ".neex", ".sface"],
    resolve: (file, root, env) => {
      const project = findUp(dirname(file), root, (dir) => isFile(join(dir, "mix.exs")));
      const bin = project === undefined ? undefined : onPath("mix", env);
      return project === undefined || bin === undefined ? undefined : { command: bin, args: ["format", file], cwd: project };
    },
  },
  nodePackage("oxfmt", "oxfmt", "oxfmt", JS_EXTENSIONS, []),
  nodePackage("prettier", "Prettier", "prettier", WEB_EXTENSIONS, ["--write"]),
  {
    name: "biome",
    title: "Biome",
    extensions: WEB_EXTENSIONS,
    resolve: (file, root) => {
      const project = findUp(dirname(file), root, (dir) => isFile(join(dir, "biome.json")) || isFile(join(dir, "biome.jsonc")));
      const bin = project === undefined ? undefined : localBin(dirname(file), root, join("node_modules", ".bin", "biome"));
      return project === undefined || bin === undefined ? undefined : { command: bin, args: ["format", "--write", file], cwd: project };
    },
  },
  canonical("zig", "zig fmt", [".zig", ".zon"], ["fmt"]),
  configured("clang-format", "clang-format", [".c", ".cc", ".cpp", ".cxx", ".c++", ".h", ".hh", ".hpp", ".hxx", ".h++", ".ino", ".C", ".H"], ".clang-format", ["-i"]),
  {
    name: "ruff",
    title: "Ruff",
    extensions: [".py", ".pyi"],
    resolve: (file, root, env) => {
      const project = findUp(dirname(file), root, (dir) => isFile(join(dir, "ruff.toml")) || isFile(join(dir, ".ruff.toml")) || readText(join(dir, "pyproject.toml")).includes("[tool.ruff"));
      if (project === undefined) return undefined;
      const bin = localBin(project, root, join(".venv", "bin", "ruff")) ?? onPath("ruff", env);
      return bin === undefined ? undefined : { command: bin, args: ["format", file], cwd: project };
    },
  },
  canonical("dart", "dart format", [".dart"], ["format"]),
  configured("ocamlformat", "ocamlformat", [".ml", ".mli"], ".ocamlformat", ["-i"]),
  canonical("terraform", "terraform fmt", [".tf", ".tfvars"], ["fmt"]),
  canonical("gleam", "gleam format", [".gleam"], ["format"]),
  {
    name: "rustfmt",
    title: "rustfmt",
    extensions: [".rs"],
    resolve: (file, root, env) => {
      const bin = onPath("rustfmt", env);
      if (bin === undefined) return undefined;
      // A bare rustfmt parses the 2015 edition and refuses newer syntax, so
      // the crate's edition is passed: the nearest literal one walking up,
      // which reaches a workspace's `[workspace.package]` when a member
      // inherits it.
      const crate = findUp(dirname(file), root, (dir) => isFile(join(dir, "Cargo.toml")));
      let edition;
      if (crate !== undefined) {
        const declaring = findUp(crate, root, (dir) => cargoEdition(readText(join(dir, "Cargo.toml"))) !== undefined);
        edition = declaring === undefined ? undefined : cargoEdition(readText(join(declaring, "Cargo.toml")));
      }
      return { command: bin, args: [...(edition === undefined ? [] : ["--edition", edition]), file], cwd: crate ?? dirname(file) };
    },
  },
  {
    name: "pint",
    title: "Pint",
    extensions: [".php"],
    resolve: (file, root) => {
      const project = findUp(dirname(file), root, (dir) => {
        const manifest = readJson(join(dir, "composer.json"));
        return hasKey(manifest, "require", "laravel/pint") || hasKey(manifest, "require-dev", "laravel/pint");
      });
      const bin = project === undefined ? undefined : executable(join(project, "vendor", "bin", "pint"));
      return project === undefined || bin === undefined ? undefined : { command: bin, args: [file], cwd: project };
    },
  },
];

/**
 * A one-style formatter: it runs whenever its binary is on `PATH`, in the
 * file's own directory.
 * @param {string} name
 * @param {string} title
 * @param {readonly string[]} extensions
 * @param {readonly string[]} args
 * @returns {Formatter}
 */
function canonical(name, title, extensions, args) {
  return {
    name,
    title,
    extensions,
    resolve: (file, _root, env) => {
      const bin = onPath(name, env);
      return bin === undefined ? undefined : { command: bin, args: [...args, file], cwd: dirname(file) };
    },
  };
}

/**
 * A formatter the project opts into with a config file of its own name, with
 * its binary on `PATH`.
 * @param {string} name
 * @param {string} title
 * @param {readonly string[]} extensions
 * @param {string} configFile
 * @param {readonly string[]} args
 * @returns {Formatter}
 */
function configured(name, title, extensions, configFile, args) {
  return {
    name,
    title,
    extensions,
    resolve: (file, root, env) => {
      const project = findUp(dirname(file), root, (dir) => isFile(join(dir, configFile)));
      const bin = project === undefined ? undefined : onPath(name, env);
      return project === undefined || bin === undefined ? undefined : { command: bin, args: [...args, file], cwd: project };
    },
  };
}

/**
 * A formatter the project opts into by depending on its npm package: a
 * `package.json` walking up that names it in `dependencies` or
 * `devDependencies`, with the binary in the nearest `node_modules/.bin` from
 * there up (a workspace may hoist it to the root).
 * @param {string} name
 * @param {string} title
 * @param {string} pkg
 * @param {readonly string[]} extensions
 * @param {readonly string[]} args
 * @returns {Formatter}
 */
function nodePackage(name, title, pkg, extensions, args) {
  return {
    name,
    title,
    extensions,
    resolve: (file, root) => {
      for (const dir of ancestors(dirname(file), root)) {
        const manifest = readJson(join(dir, "package.json"));
        if (!hasKey(manifest, "dependencies", pkg) && !hasKey(manifest, "devDependencies", pkg)) continue;
        const bin = localBin(dir, root, join("node_modules", ".bin", pkg));
        if (bin !== undefined) return { command: bin, args: [...args, file], cwd: dir };
      }
      return undefined;
    },
  };
}

/**
 * The directories from `dir` up to `root`, both included; empty when `dir`
 * is not under `root`.
 * @param {string} dir
 * @param {string} root
 * @returns {string[]}
 */
export function ancestors(dir, root) {
  if (!within(dir, root)) return [];
  const out = [dir];
  for (let current = dir; current !== root; ) {
    current = dirname(current);
    out.push(current);
  }
  return out;
}

/**
 * The nearest directory from `dir` up to `root` that `holds`.
 * @param {string} dir
 * @param {string} root
 * @param {(dir: string) => boolean} holds
 * @returns {string | undefined}
 */
export function findUp(dir, root, holds) {
  return ancestors(dir, root).find(holds);
}

/**
 * The nearest executable `dir/<path>` from `dir` up to `root`.
 * @param {string} dir
 * @param {string} root
 * @param {string} path
 * @returns {string | undefined}
 */
function localBin(dir, root, path) {
  for (const candidate of ancestors(dir, root)) {
    const bin = executable(join(candidate, path));
    if (bin !== undefined) return bin;
  }
  return undefined;
}

/**
 * `name` as the first executable file on the environment's `PATH`.
 * @param {string} name
 * @param {Env} env
 * @returns {string | undefined}
 */
export function onPath(name, env) {
  for (const dir of (env["PATH"] ?? "").split(delimiter)) {
    if (dir === "" || !isAbsolute(dir)) continue;
    const bin = executable(join(dir, name));
    if (bin !== undefined) return bin;
  }
  return undefined;
}

/**
 * `path` when it is an executable regular file.
 * @param {string} path
 * @returns {string | undefined}
 */
function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile() ? path : undefined;
  } catch {
    return undefined;
  }
}

/** @param {string} path */
function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** @param {string} path */
function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {string} path
 * @returns {unknown}
 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Whether `value[field]` is an object carrying `key`.
 * @param {unknown} value
 * @param {string} field
 * @param {string} key
 */
function hasKey(value, field, key) {
  if (!isObject(value)) return false;
  const inner = value[field];
  return isObject(inner) && Object.hasOwn(inner, key);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The literal `edition` a `Cargo.toml` declares under `[package]` or
 * `[workspace.package]`; `undefined` when it declares none or inherits it.
 * @param {string} text
 * @returns {string | undefined}
 */
export function cargoEdition(text) {
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]/.exec(line);
    if (header) {
      section = (header[1] ?? "").trim();
      continue;
    }
    if (section !== "package" && section !== "workspace.package") continue;
    const edition = /^edition\s*=\s*["']([^"']+)["']/.exec(line);
    if (edition) return edition[1];
  }
  return undefined;
}

/**
 * Whether `path` is `root` or lies beneath it.
 * @param {string} path
 * @param {string} root
 */
function within(path, root) {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

/**
 * The formatters for `file` whose evidence holds, in table order, ready to run.
 * @param {string} file the file's real absolute path
 * @param {string} root the workspace root's real absolute path
 * @param {Env} env
 * @returns {{ formatter: Formatter, invocation: Invocation }[]}
 */
export function formattersFor(file, root, env) {
  const ext = extname(file);
  const out = [];
  for (const formatter of FORMATTERS) {
    if (!formatter.extensions.includes(ext)) continue;
    const invocation = formatter.resolve(file, root, env);
    if (invocation !== undefined) out.push({ formatter, invocation });
  }
  return out;
}

/**
 * The first and last line (1-based, on the `after` side) that differ between
 * two versions of a file, by a common-prefix and common-suffix scan. When the
 * change only removed lines, both name the line that now sits where they were.
 * @param {string} before
 * @param {string} after
 * @returns {{ first: number, last: number }}
 */
export function changedLines(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const first = Math.min(prefix + 1, b.length);
  const last = Math.max(first, b.length - suffix);
  return { first, last };
}

/**
 * The hook's whole behaviour for one call: what to print on stdout and
 * stderr and the exit code.
 * @param {string} stdin the hook's input, Claude Code's PostToolUse JSON
 * @param {Env} env the hook's environment; formatters run with it
 * @param {{ timeoutMs?: number }} [options]
 * @returns {HookAnswer}
 */
export function formatAfterEdit(stdin, env, options = {}) {
  /** @type {unknown} */
  let input;
  try {
    input = JSON.parse(stdin);
  } catch {
    input = undefined;
  }
  if (!isObject(input)) return { stdout: "", stderr: `${LOG_PREFIX} unreadable hook input\n`, exitCode: 1 };
  const silent = { stdout: "", stderr: "", exitCode: 0 };

  const toolInput = input["tool_input"];
  const path = isObject(toolInput) ? toolInput["file_path"] : undefined;
  if (typeof path !== "string" || path === "") return silent;
  const response = input["tool_response"];
  const output = isObject(response) ? response["output"] : undefined;
  if (typeof output === "string" && FAILED_RESULT.test(output)) return silent;

  const projectDir = env["CLAUDE_PROJECT_DIR"];
  if (projectDir === undefined || projectDir === "") return silent;
  let root;
  let file;
  try {
    root = realpathSync(projectDir);
    file = realpathSync(path);
  } catch {
    return silent;
  }
  if (!within(file, root) || !isFile(file)) return silent;

  const candidates = formattersFor(file, root, env);
  if (candidates.length === 0) return silent;

  const before = readFileSync(file);
  const timeout = options.timeoutMs ?? FORMATTER_TIMEOUT_MS;
  const failures = [];
  let formatted;
  for (const { formatter, invocation } of candidates) {
    const run = spawnSync(invocation.command, invocation.args, { cwd: invocation.cwd, env: { ...env }, stdio: "ignore", timeout, killSignal: "SIGKILL" });
    if (run.status === 0) {
      formatted = formatter;
      break;
    }
    failures.push(`${formatter.name} ${howItEnded(run, timeout)}`);
  }
  if (formatted === undefined) return { stdout: "", stderr: `${LOG_PREFIX} ${failures.join("; ")}\n`, exitCode: 1 };

  const after = readFileSync(file);
  if (after.equals(before)) return silent;
  const { first, last } = changedLines(before.toString("utf8"), after.toString("utf8"));
  const lines = first === last ? `line ${first}` : `lines ${first}-${last}`;
  const shown = relative(root, file).split(sep).join("/");
  const notice = `${formatted.title} reformatted ${shown} after this change (${lines} now differ from what you wrote). Read those lines again before quoting them in another edit.`;
  return {
    stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: notice } }),
    stderr: "",
    exitCode: 0,
  };
}

/**
 * How a formatter run that did not exit 0 ended, in words for the log.
 * @param {import("node:child_process").SpawnSyncReturns<Buffer>} run
 * @param {number} timeout
 */
function howItEnded(run, timeout) {
  const code = run.error && "code" in run.error ? run.error.code : undefined;
  if (code === "ETIMEDOUT") return `timed out after ${timeout} ms`;
  if (run.error) return `did not start (${code ?? run.error.message})`;
  if (run.signal) return `was killed by ${run.signal}`;
  return `exited ${run.status}`;
}

/* v8 ignore start -- @preserve: the process entry; the tests' child-process cases run these lines, and a child's lines are not in the suite's coverage */
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const answer = formatAfterEdit(readFileSync(0, "utf8"), process.env);
  process.stdout.write(answer.stdout);
  process.stderr.write(answer.stderr);
  process.exitCode = answer.exitCode;
}
/* v8 ignore stop */
