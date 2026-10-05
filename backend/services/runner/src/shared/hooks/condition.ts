/**
 * A handler's `if`: Claude Code's permission-rule matcher, deciding whether
 * the handler runs for a call its group already matched.
 *
 * The rule is `Tool` or `Tool(specifier)`, read against the call as a hook
 * sees it (`tool-view.ts`):
 *
 *  - `Bash(spec)` matches when ANY simple command of the input matches
 *    (`shell-commands.ts` splits it, nested substitutions and subshells
 *    included), with leading assignments and wrappers also tried stripped.
 *    The wrappers are Claude's (`timeout`, `time`, `nice`, `nohup`,
 *    `stdbuf`, `command`, `builtin`, `noglob`, `xargs`) and a few more that
 *    run their arguments (`exec`, `env`, `sudo`, `doas`, `setsid`,
 *    `ionice`, `chrt`, `taskset`, `watch`); since their options may take
 *    arguments, every word after one is tried as the command's start. A
 *    command named by path (`/bin/rm`) is also tried by its last segment.
 *    `*` is any text; a trailing ` *` also matches the bare command, so
 *    `git *` matches `git`, and the older `:*` is a prefix. A word the shell
 *    would expand (`$x`, `$(…)`, a glob, a brace list, a redirection) could
 *    be anything, so only the words before it decide: a command they rule
 *    out does not match, and any other might. Wider than Claude's rule is
 *    the safe side here (see below).
 *  - `Read(path)` and `Edit(path)` are gitignore-style paths, matched
 *    against the real absolute path: `//abs` from the filesystem root, `~/p`
 *    from home, `/p` from the workspace root, `p` or `./p` from the
 *    workspace root at any depth when it has no slash. `Read` also governs
 *    `Grep` and `Glob`, and `Edit` every tool that writes a file, as
 *    Claude's rules do.
 *  - `WebFetch(domain:host)` matches the URL's host; `*.host` any subdomain.
 *  - `Agent(type)` matches the sub-agent type, ignoring case.
 *  - `Tool(param:value)` matches a top-level argument, `*` being any text.
 *  - `mcp__server` and `mcp__server__*` match every tool of the server.
 *
 * One safety rule over all of it: when the matcher cannot be sure a rule
 * does not match (a shape it does not know, a command it cannot parse, a
 * search whose reach it cannot bound), the handler runs. Running a hook too
 * often costs a process and the hook still decides; skipping one would
 * silently drop a policy. Claude's own page says Bash rules are not a
 * security boundary; the hook's script is.
 *
 * Every `*` is matched by {@link wildcardMatch}, a linear scan, never a
 * regular expression built from the rule: the text it reads is the model's,
 * and a rule with many stars would otherwise backtrack over it.
 */

import { join } from "node:path";
import picomatch from "picomatch";
import { splitShellCommands, type ShellCommand, type ShellWord } from "./shell-commands.js";
import type { ToolView } from "./tool-view.js";

/** Where relative rule paths are anchored. */
export interface ConditionContext {
  /** The workspace root: the project directory and the hook's working directory. */
  readonly workspaceRoot: string;
  readonly homeDir: string;
}

const RULE = /^([A-Za-z_][A-Za-z0-9_-]*)(?:\(([\s\S]*)\))?$/;

/** The tools each path-rule tool governs, as Claude Code's permission rules do. */
const PATH_RULE_TOOLS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Read", new Set(["Read", "Grep", "Glob"])],
  ["Edit", new Set(["Edit", "Write", "NotebookEdit"])],
]);

/** Claude Code's older name for `Agent`. */
const TOOL_ALIASES: ReadonlyMap<string, string> = new Map([["Task", "Agent"]]);

/** Whether a handler with this `if` runs for this call. */
export function conditionMatches(rule: string, view: ToolView, ctx: ConditionContext): boolean {
  const parsed = RULE.exec(rule.trim());
  if (parsed === null) return true;
  const tool = TOOL_ALIASES.get(parsed[1]!) ?? parsed[1]!;
  const spec = parsed[2]?.trim();

  if (!toolMatches(tool, view.toolName)) return false;
  if (spec === undefined || spec === "" || spec === "*") return true;

  if (tool === "Bash") return bashMatches(spec, view.toolInput["command"]);
  if (PATH_RULE_TOOLS.has(tool)) return pathMatches(spec, view, ctx);
  if (tool === "WebFetch" && spec.startsWith("domain:")) return domainMatches(spec.slice("domain:".length), view.toolInput["url"]);
  if (tool === "Agent") return agentMatches(spec, view.toolInput["subagent_type"]);
  return argumentMatches(spec, view.toolInput);
}

function toolMatches(tool: string, toolName: string): boolean {
  if (tool === toolName) return true;
  if (tool.startsWith("mcp__")) {
    const server = tool.endsWith("__*") ? tool.slice(0, -"__*".length) : tool;
    return !server.slice("mcp__".length).includes("__") && toolName.startsWith(`${server}__`);
  }
  return PATH_RULE_TOOLS.get(tool)?.has(toolName) ?? false;
}

// ── Bash ──────────────────────────────────────────────────────────

const WRAPPERS = new Set([
  "timeout", "time", "nice", "nohup", "stdbuf", "command", "builtin", "noglob", "xargs",
  "exec", "env", "sudo", "doas", "setsid", "ionice", "chrt", "taskset", "watch",
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** How many forms of one simple command are tried, at most; past it the command matches. */
const MAX_FORMS = 256;

function bashMatches(spec: string, command: unknown): boolean {
  if (typeof command !== "string") return true;
  const commands = splitShellCommands(command);
  if (commands === null) return true;
  const patterns = bashPatterns(spec);
  return commands.some((words) => {
    const forms = commandForms(words);
    return forms === null || forms.some((form) => formMatches(patterns, form));
  });
}

/**
 * A Bash specifier as the glob patterns a command's words, joined by single
 * spaces, may match: `git push *` is `git push` or `git push *`; the older
 * `npm run test:*` is the prefix `npm run test*`.
 */
function bashPatterns(spec: string): readonly string[] {
  const body = collapse(spec);
  if (body.endsWith(":*")) return [`${body.slice(0, -2)}*`];
  if (body.endsWith(" *")) return [body.slice(0, -2), body];
  return [body];
}

/**
 * Whether one form of a command may match: by its whole text when every
 * word is literal; otherwise by the words before the first one the shell
 * would expand, which may expand to nothing or continue into anything.
 */
function formMatches(patterns: readonly string[], words: readonly ShellWord[]): boolean {
  const open = words.findIndex((word) => !word.literal);
  if (open === -1) {
    const text = joinWords(words);
    return patterns.some((pattern) => wildcardMatch(pattern, text));
  }
  const known = joinWords(words.slice(0, open));
  return patterns.some((pattern) => wildcardMatch(pattern, known) || couldContinue(pattern, known === "" ? "" : `${known} `));
}

/** Whether some text that starts with `prefix` matches `pattern`. */
function couldContinue(pattern: string, prefix: string): boolean {
  const star = pattern.indexOf("*");
  const literal = star === -1 ? pattern : pattern.slice(0, star);
  if (literal.length >= prefix.length) return literal.startsWith(prefix);
  return star !== -1 && prefix.startsWith(literal);
}

/**
 * Each command a simple command may run: itself without its leading
 * assignments, and after a wrapper every later word as the start; a command
 * named by path is also tried by its last segment. `null` when there are too
 * many to try, which matches.
 */
function commandForms(words: ShellCommand): (readonly ShellWord[])[] | null {
  const forms: (readonly ShellWord[])[] = [];
  const pending: (readonly ShellWord[])[] = [words];
  while (pending.length > 0) {
    const form = pending.pop()!;
    let assignments = 0;
    while (assignments < form.length && ASSIGNMENT.test(form[assignments]!.text)) assignments += 1;
    if (assignments > 0) {
      // An assignment runs nothing; the command after it is the one to judge.
      pending.push(form.slice(assignments));
      continue;
    }
    if (form.length === 0) continue;
    forms.push(form);
    if (forms.length + pending.length > MAX_FORMS) return null;
    const head = form[0]!;
    if (head.literal && head.text.includes("/") && !head.text.endsWith("/")) {
      pending.push([{ text: head.text.slice(head.text.lastIndexOf("/") + 1), literal: true }, ...form.slice(1)]);
    }
    if (head.literal && WRAPPERS.has(head.text)) {
      if (forms.length + pending.length + form.length > MAX_FORMS) return null;
      for (let start = 1; start < form.length; start++) pending.push(form.slice(start));
    }
  }
  return forms;
}

function joinWords(words: readonly ShellWord[]): string {
  return collapse(words.map((word) => word.text).join(" "));
}

function collapse(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Whether `text` matches `pattern`, where `*` is any run of characters and
 * every other character is itself. A greedy scan that backtracks only to the
 * last star, so its work is bounded by the two lengths' product.
 */
export function wildcardMatch(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let resume = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === "*") {
      star = p;
      resume = t;
      p += 1;
    } else if (p < pattern.length && pattern[p] === text[t]) {
      p += 1;
      t += 1;
    } else if (star !== -1) {
      p = star + 1;
      resume += 1;
      t = resume;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === "*") p += 1;
  return p === pattern.length;
}

// ── Paths ─────────────────────────────────────────────────────────

const FILE_PATH_TOOLS = new Set(["Read", "Edit", "Write", "NotebookEdit"]);

function pathMatches(spec: string, view: ToolView, ctx: ConditionContext): boolean {
  // A search reads under a directory whose contents the rule cannot be
  // checked against without walking it: unsure, so the handler runs.
  if (!FILE_PATH_TOOLS.has(view.toolName)) return true;
  const target = view.toolInput["file_path"] ?? view.toolInput["notebook_path"];
  if (typeof target !== "string") return true;
  const pattern = absolutePattern(spec, ctx);
  const isMatch = picomatch([pattern, `${pattern.replace(/\/+$/, "")}/**`], { dot: true });
  return isMatch(target);
}

/** A gitignore-style rule path as an absolute glob. */
function absolutePattern(spec: string, ctx: ConditionContext): string {
  if (spec.startsWith("//")) return spec.slice(1);
  if (spec.startsWith("~/")) return join(ctx.homeDir, spec.slice(2));
  if (spec.startsWith("/")) return join(ctx.workspaceRoot, spec);
  const relative = spec.replace(/^\.\//, "");
  const anchored = relative.replace(/\/+$/, "").includes("/") || spec.startsWith("./");
  return anchored ? join(ctx.workspaceRoot, relative) : join(ctx.workspaceRoot, "**", relative);
}

// ── The rest ──────────────────────────────────────────────────────

function domainMatches(domain: string, url: unknown): boolean {
  if (typeof url !== "string") return true;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  const want = domain.trim().toLowerCase();
  return want.startsWith("*.") ? host.endsWith(want.slice(1)) : host === want;
}

function agentMatches(spec: string, subagentType: unknown): boolean {
  if (typeof subagentType !== "string" || subagentType === "") return true;
  return spec.toLowerCase() === subagentType.toLowerCase();
}

function argumentMatches(spec: string, input: Record<string, unknown>): boolean {
  const colon = spec.indexOf(":");
  if (colon <= 0) return true;
  const value = input[spec.slice(0, colon).trim()];
  if (value === undefined || value === null) return false;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return true;
  return wildcardMatch(spec.slice(colon + 1).trim(), String(value));
}
