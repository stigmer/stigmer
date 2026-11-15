#!/usr/bin/env node

/**
 * Installs Stigmer's plugin for coding agents the way a person does, from its
 * public repository, in Claude Code and in Codex, and fails unless each tool
 * reports the plugin at the expected version. No model, no key and no
 * sign-in: only the tools' own plugin commands.
 *
 * The reconcile lane runs it after every reconcile of stigmer/coding-agent-plugin
 * (.github/workflows/reconcile-coding-agent-plugin.yaml), on a release and
 * daily, so a tool that stops accepting the plugin's format, or a repository
 * that stops carrying the release, turns the lane red before a person meets
 * it. Cursor installs a plugin only by a folder copy and a window reload, so
 * it has no step here.
 *
 *   node test/install/coding-agent-plugin-install.mjs --version=<v> [--source=<owner/repo | git URL | path>]
 *
 * `--source` defaults to stigmer/coding-agent-plugin; a local path checks a
 * packed tree before it is published. Each tool runs with a scratch HOME (and
 * Codex a scratch CODEX_HOME), so nothing of the person's own settings is
 * read or written, and in a scratch git repository for Claude Code's
 * project scope. `claude` and `codex` are whatever PATH finds: the lane
 * installs both at pinned versions.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The plugin's id in both tools: the plugin `stigmer` from the marketplace `stigmer`. */
export const PLUGIN_ID = "stigmer@stigmer";
export const DEFAULT_SOURCE = "stigmer/coding-agent-plugin";

/** The version `claude plugin list --json` reports for the plugin, or `undefined` when it is not installed. Pure. */
export function claudeInstalledVersion(listJson) {
  const entries = JSON.parse(listJson);
  if (!Array.isArray(entries)) throw new Error("claude plugin list --json: expected an array");
  return entries.find((entry) => entry?.id === PLUGIN_ID)?.version;
}

/** The version `codex plugin list --json` reports for the plugin, or `undefined` when it is not installed. Pure. */
export function codexInstalledVersion(listJson) {
  const { installed } = JSON.parse(listJson);
  if (!Array.isArray(installed)) throw new Error("codex plugin list --json: expected an `installed` array");
  return installed.find((entry) => entry?.pluginId === PLUGIN_ID)?.version;
}

/** The command line's options; throws naming what is missing or unknown. Pure. */
export function parseArgs(argv) {
  const options = { source: DEFAULT_SOURCE, version: undefined };
  for (const arg of argv) {
    const match = /^--(source|version)=(.+)$/.exec(arg);
    if (match === null) throw new Error(`unknown argument ${arg}; usage: --version=<v> [--source=<owner/repo | git URL | path>]`);
    options[match[1]] = match[2];
  }
  if (options.version === undefined) throw new Error("--version=<v> is required: the version each tool must report");
  return options;
}

/** A local path names a folder on this machine; anything else is a repository a tool fetches itself. */
function localSource(source) {
  const path = resolve(source);
  return existsSync(path) ? path : undefined;
}

function run(command, args, { cwd, env }) {
  return execFileSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Install in both tools from `source` in a scratch home; returns one line per tool, or throws naming each mismatch. */
export function checkInstalls({ source, version }) {
  const scratch = mkdtempSync(join(tmpdir(), "coding-agent-plugin-install-"));
  try {
    const home = join(scratch, "home");
    const project = join(scratch, "project");
    mkdirSync(home);
    mkdirSync(project);
    const env = {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      CODEX_HOME: join(scratch, "codex-home"),
    };
    mkdirSync(env.CODEX_HOME);
    run("git", ["init", "-q"], { cwd: project, env });

    // Claude Code validates the tree a person's install reads, so a manifest
    // it would refuse fails here by name, then installs as the docs say.
    let tree = localSource(source);
    if (tree === undefined) {
      tree = join(scratch, "clone");
      const url = /^[\w.-]+\/[\w.-]+$/.test(source) ? `https://github.com/${source}` : source;
      run("git", ["clone", "-q", "--depth", "1", url, tree], { cwd: scratch, env });
    }
    run("claude", ["plugin", "validate", tree], { cwd: project, env });
    run("claude", ["plugin", "install", "stigmer", "--marketplace", localSource(source) ?? source, "--scope", "project"], { cwd: project, env });
    const claude = claudeInstalledVersion(run("claude", ["plugin", "list", "--json"], { cwd: project, env }));

    run("codex", ["plugin", "marketplace", "add", localSource(source) ?? source], { cwd: project, env });
    run("codex", ["plugin", "add", PLUGIN_ID], { cwd: project, env });
    const codex = codexInstalledVersion(run("codex", ["plugin", "list", "--json"], { cwd: project, env }));

    const lines = [
      `Claude Code: ${PLUGIN_ID} installed at ${claude ?? "(not installed)"}`,
      `Codex: ${PLUGIN_ID} installed at ${codex ?? "(not installed)"}`,
    ];
    if (claude !== version || codex !== version) {
      throw new Error(`expected ${version} from ${source}:\n  ${lines.join("\n  ")}`);
    }
    return lines;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    for (const line of checkInstalls(options)) console.log(line);
  } catch (error) {
    const stderr = error?.stderr ? `\n${String(error.stderr).trim()}` : "";
    console.error(`coding-agent-plugin-install: ${error instanceof Error ? error.message : String(error)}${stderr}`);
    process.exit(1);
  }
}
