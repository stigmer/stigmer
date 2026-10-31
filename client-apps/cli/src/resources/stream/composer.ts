// What `stigmer run` and `stigmer resume` add to the terminal kit's composer,
// through the kit's host hooks (ComposerExtensions), the way any host CLI
// would:
//   - `/help`, `/mode plan|agent`, `/stop` and `/exit`;
//   - `@` completing paths under the session's local folders, each sent as a
//     workspace reference (the same workspace-relative path `--attach` sends
//     for a file inside a folder), so the agent reads the file in place;
//   - a prompt history per working directory, under the config directory,
//     mode 0600 because a prompt can hold a secret, the last 500 kept.
//
// Trade-offs:
//   - The `@` walk is bounded (depth, files read, names skipped such as
//     `node_modules` and `.git`), so a large tree answers at once; a file past
//     the bound is still reachable by `--attach`.
//   - A history file that cannot be read or written is no history: the
//     session goes on, as it would with none.
//
// Proven by __tests__/composer.test.ts.

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import type { CompletionItem, CompletionSource, ComposerExtensions, PromptHistory, SlashCommand } from "@stigmer/ink-ui";
import { configDir } from "../../config/paths.js";

/** The most entries a history file keeps. */
export const HISTORY_LIMIT = 500;
/** The most items the `@` menu offers. */
const COMPLETION_LIMIT = 20;
/** How deep, and how many entries, the `@` walk reads. */
const WALK_DEPTH = 6;
const WALK_ENTRIES = 5000;
/** Names the `@` walk does not enter. */
const SKIPPED = new Set([".git", "node_modules", ".venv", "dist", "build", ".next", "target", "__pycache__"]);

/** The session's commands: help, mode, stop and exit. */
export function cliCommands(): readonly SlashCommand[] {
  const commands: SlashCommand[] = [
    {
      name: "help",
      description: "List the commands and keys",
      run: (_args, context) =>
        context.note(
          [
            ...commands.map((command) => `/${command.name}${command.args ? ` ${command.args}` : ""}  ${command.description}`),
            "@<path>  mention a file in the session's folder",
            "Esc stops the agent · Ctrl+C twice leaves (the agent keeps working) · ↑ earlier messages · ? keys",
          ].join("\n"),
        ),
    },
    {
      name: "mode",
      description: "Switch to plan (read-only) or agent mode",
      args: "plan|agent",
      run: (args, context) => {
        if (args === "plan" || args === "agent") context.setMode(args);
        else context.note(`/mode takes plan or agent; this session is in ${context.mode} mode.`);
      },
    },
    { name: "stop", description: "Stop the agent's turn", run: (_args, context) => context.stop() },
    { name: "exit", description: "Leave; the agent keeps working", run: (_args, context) => context.leave() },
  ];
  return commands;
}

/** The `@` completions over files under `roots`, each a workspace reference. */
export function workspaceCompletion(roots: readonly string[]): CompletionSource {
  return {
    trigger: "@",
    complete: (query) => {
      const needle = query.toLowerCase();
      const items: CompletionItem[] = [];
      for (const root of roots) {
        for (const path of walk(root)) {
          if (!path.toLowerCase().includes(needle)) continue;
          items.push({ label: path, insert: `@${path}`, attach: { workspaceFileRefs: [path] } });
          if (items.length >= COMPLETION_LIMIT) return rank(items, needle);
        }
      }
      return rank(items, needle);
    },
  };
}

/** Paths whose file name starts with the query first, then the shorter. */
function rank(items: readonly CompletionItem[], needle: string): readonly CompletionItem[] {
  const named = (item: CompletionItem) => (item.label.split("/").at(-1)!.toLowerCase().startsWith(needle) ? 0 : 1);
  return [...items].sort((a, b) => named(a) - named(b) || a.label.length - b.label.length || a.label.localeCompare(b.label));
}

/** The files under `root`, as `/`-separated paths relative to it, within the walk's bounds. */
function walk(root: string): string[] {
  const files: string[] = [];
  let read = 0;
  const visit = (dir: string, depth: number): void => {
    if (depth > WALK_DEPTH || read >= WALK_ENTRIES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      read += 1;
      if (read > WALK_ENTRIES) return;
      if (SKIPPED.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path, depth + 1);
      else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
    }
  };
  visit(root, 0);
  return files;
}

/** The local folders of `roots` that exist on this machine as folders. */
export function presentRoots(roots: readonly string[]): readonly string[] {
  return roots.filter((root) => {
    try {
      return statSync(root).isDirectory();
    } catch {
      return false;
    }
  });
}

/** Where the history of prompts typed in `cwd` lives. */
export function historyPath(cwd: string, home: string = homedir()): string {
  const key = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
  return join(configDir(home), "history", `${key}.json`);
}

/** The prompt history of `cwd`, in a file only its owner reads (module header). */
export function fileHistory(cwd: string, home: string = homedir()): PromptHistory {
  const path = historyPath(cwd, home);
  const read = (): string[] => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    load: read,
    append: (entry) => {
      const entries = read();
      if (entry.trim() === "" || entries.at(-1) === entry) return;
      try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(path, `${JSON.stringify([...entries, entry].slice(-HISTORY_LIMIT))}\n`, { mode: 0o600 });
        chmodSync(path, 0o600);
      } catch {
        // No history this time; the session goes on.
      }
    },
  };
}

/** The composer `stigmer run` and `stigmer resume` give the session view. */
export function cliComposer(roots: readonly string[], cwd: string = process.cwd()): ComposerExtensions {
  const present = presentRoots(roots);
  return {
    commands: cliCommands(),
    completions: present.length > 0 ? [workspaceCompletion(present)] : [],
    history: fileHistory(cwd),
  };
}
