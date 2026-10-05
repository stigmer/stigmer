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
 *    `ionice`, `chrt`, `taskset`, `watch`, `busybox`); since their options
 *    may take arguments, every word after one is tried as the command's
 *    start, as is the word after `find`'s `-exec`, `-execdir`, `-ok` and
 *    `-okdir`. A command named by path (`/bin/rm`) is also tried by its
 *    last segment.
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
 * silently drop a policy. Such a match is `unsure` ({@link conditionVerdict}),
 * and the evaluator honours a refusal or an ask from it but not an allow: an
 * allow behind an `if` that only might have matched would let a call the
 * rule never names skip its approval. Claude's own page says Bash rules are
 * not a security boundary; the hook's script is.
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

/** How an `if` reads a call: it matches, it might (the matcher cannot be sure), or it does not. */
export type ConditionVerdict = "match" | "unsure" | "no";

/** Whether a handler with this `if` runs for this call. */
export function conditionMatches(rule: string, view: ToolView, ctx: ConditionContext): boolean {
  return conditionVerdict(rule, view, ctx) !== "no";
}

/** How a handler's `if` reads this call; an `unsure` handler runs, and its allow is not honoured. */
export function conditionVerdict(rule: string, view: ToolView, ctx: ConditionContext): ConditionVerdict {
  const parsed = RULE.exec(rule.trim());
  if (parsed === null) return "unsure";
  const tool = TOOL_ALIASES.get(parsed[1]!) ?? parsed[1]!;
  const spec = parsed[2]?.trim();

  if (!toolMatches(tool, view.toolName)) return "no";
  if (spec === undefined || spec === "" || spec === "*") return "match";

  if (tool === "Bash") return bashVerdict(spec, view.toolInput["command"]);
  if (PATH_RULE_TOOLS.has(tool)) return pathVerdict(spec, view, ctx);
  if (tool === "WebFetch" && spec.startsWith("domain:")) return domainVerdict(spec.slice("domain:".length), view.toolInput["url"]);
  if (tool === "Agent") return agentVerdict(spec, view.toolInput["subagent_type"]);
  return argumentVerdict(spec, view.toolInput);
}

/** The strongest of several readings: one sure match is a match. */
function strongest(verdicts: Iterable<ConditionVerdict>): ConditionVerdict {
  let best: ConditionVerdict = "no";
  for (const verdict of verdicts) {
    if (verdict === "match") return "match";
    if (verdict === "unsure") best = "unsure";
  }
  return best;
}

const sure = (matched: boolean): ConditionVerdict => (matched ? "match" : "no");
const atMostUnsure = (verdict: ConditionVerdict): ConditionVerdict => (verdict === "match" ? "unsure" : verdict);

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
  "exec", "env", "sudo", "doas", "setsid", "ionice", "chrt", "taskset", "watch", "busybox",
]);

/** `find`'s actions that run the words after them as a command. */
const FIND_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** How many forms of one simple command are tried, at most; past it the command matches. */
const MAX_FORMS = 256;

function bashVerdict(spec: string, command: unknown): ConditionVerdict {
  if (typeof command !== "string") return "unsure";
  const commands = splitShellCommands(command);
  if (commands === null) return "unsure";
  const patterns = bashPatterns(spec);
  return strongest(
    commands.map((words) => {
      const forms = commandForms(words);
      if (forms === null) return "unsure";
      // Only the command as written can match for sure: a peeled form is
      // the matcher's reading of what runs, and an assignment (`PATH=…`) or
      // a path can change which program that is.
      const verdict = strongest(forms.map((form) => (form === words ? formVerdict(patterns, form) : atMostUnsure(formVerdict(patterns, form)))));
      if (verdict !== "no") return verdict;
      // On a case-insensitive disk `RM -rf build` runs `rm`: a match that
      // holds only ignoring case is unsure.
      const lower = patterns.map((pattern) => pattern.toLowerCase());
      const folded = forms.map((form) => form.map((word) => ({ ...word, text: word.text.toLowerCase() })));
      return folded.some((form) => formVerdict(lower, form) !== "no") ? "unsure" : "no";
    }),
  );
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
 * How one form of a command reads: by its whole text when every word is
 * literal; otherwise by the words before the first one the shell would
 * expand, which may expand to nothing or continue into anything. It is a
 * sure match only when every continuation matches (the words before it
 * already fill a pattern up to its trailing `*`).
 */
function formVerdict(patterns: readonly string[], words: readonly ShellWord[]): ConditionVerdict {
  const open = words.findIndex((word) => !word.literal);
  if (open === -1) {
    const text = joinWords(words);
    return sure(patterns.some((pattern) => wildcardMatch(pattern, text)));
  }
  const known = joinWords(words.slice(0, open));
  const prefix = known === "" ? "" : `${known} `;
  if (patterns.some((pattern) => pattern.endsWith("*") && wildcardMatch(pattern, prefix))) return "match";
  return patterns.some((pattern) => wildcardMatch(pattern, known) || couldContinue(pattern, prefix)) ? "unsure" : "no";
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
    } else if (head.literal && head.text === "find") {
      for (let i = 1; i < form.length - 1; i++) if (FIND_ACTIONS.has(form[i]!.text)) pending.push(form.slice(i + 1));
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

function pathVerdict(spec: string, view: ToolView, ctx: ConditionContext): ConditionVerdict {
  // A search reads under a directory whose contents the rule cannot be
  // checked against without walking it: unsure, so the handler runs.
  if (!FILE_PATH_TOOLS.has(view.toolName)) return "unsure";
  const target = view.toolInput["file_path"] ?? view.toolInput["notebook_path"];
  if (typeof target !== "string") return "unsure";
  const pattern = absolutePattern(spec, ctx);
  const patterns = [pattern, `${pattern.replace(/\/+$/, "")}/**`];
  if (picomatch(patterns, { dot: true })(target)) return "match";
  // On a case-insensitive filesystem `/ws/.ENV` is `/ws/.env`.
  return picomatch(patterns, { dot: true, nocase: true })(target) ? "unsure" : "no";
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

function domainVerdict(domain: string, url: unknown): ConditionVerdict {
  if (typeof url !== "string") return "unsure";
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "unsure";
  }
  // `evil.com.` is the same host as `evil.com`.
  if (host.endsWith(".")) host = host.slice(0, -1);
  const want = domain.trim().toLowerCase();
  return sure(want.startsWith("*.") ? host.endsWith(want.slice(1)) : host === want);
}

function agentVerdict(spec: string, subagentType: unknown): ConditionVerdict {
  if (typeof subagentType !== "string" || subagentType === "") return "unsure";
  return sure(spec.toLowerCase() === subagentType.toLowerCase());
}

function argumentVerdict(spec: string, input: Record<string, unknown>): ConditionVerdict {
  const colon = spec.indexOf(":");
  if (colon <= 0) return "unsure";
  // A specifier this shape does not describe (`WebFetch(https://…)`), or
  // an argument the call does not carry, is not a sure "no": the handler runs.
  const key = spec.slice(0, colon).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return "unsure";
  const value = input[key];
  if (value === undefined || value === null) return "unsure";
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return "unsure";
  return sure(wildcardMatch(spec.slice(colon + 1).trim(), String(value)));
}
