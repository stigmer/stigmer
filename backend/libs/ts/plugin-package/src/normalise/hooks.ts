/**
 * A plugin's hooks files into the tool-call hooks Stigmer reads, in the
 * format the plugin wrote them.
 *
 * Sources are resolved by `detect.ts`: every vendor manifest's declared
 * `hooks` (a file or an inline object) and `hooks/hooks.json`, each file
 * once. A file is `{"hooks": {<event>: [...]}}` in both formats; what sits
 * in an event's array decides which. Claude Code's entries are matcher
 * groups holding a `hooks` array of handlers; Cursor's are the handlers
 * themselves, each with its own matcher, and only Cursor's file carries
 * `version`. A file whose entries are neither, or both, or whose format no
 * manifest reaching it reads, is refused. A Claude or Codex manifest's
 * inline object is the bare event map; Cursor documents no inline form, so
 * a Cursor inline object is read in its file's shape.
 *
 * Stigmer reads hooks on tool calls only, and only command handlers that
 * can decide a call (the installer records them; no engine runs one yet): `PreToolUse` and `PostToolUse` in Claude Code's
 * format, and Cursor's `preToolUse`, `beforeShellExecution`,
 * `beforeMCPExecution`, `postToolUse` and `afterMCPExecution`. Everything
 * else is named, never dropped silently: an event once per file
 * (`hook-event-not-run`), a handler that is not a command, runs in the
 * background (`async`, `asyncRewake`) or needs PowerShell
 * (`hook-handler-not-run`), and a field Stigmer does not read
 * (`hook-field-ignored`; `once` among them, which Claude Code itself honours
 * only in skill frontmatter). The stored hooks therefore hold only what
 * runs, and the runner needs no table of its own.
 *
 * A plugin runs one format. When both formats carry tool-call hooks
 * Stigmer reads, Claude Code's win (the reader's detection precedence, and
 * the format the project treats as primary) and each Cursor source that
 * carries some is named once as not run (`hooks-format-not-run`); its own
 * event and handler warnings are not reported, since none of it runs. The
 * choice counts only sources that carry tool-call hooks, so a Claude file
 * with nothing but lifecycle events never displaces a Cursor guard.
 *
 * What is carried is checked, and a broken hook refuses the install, as a
 * broken sub-agent does: a matcher that is neither "every call", an exact
 * list, nor a regular expression JavaScript compiles (both formats test
 * matchers with JavaScript's `RegExp`), an `if` that is not a permission
 * rule's `Tool` or `Tool(specifier)` shape, a command handler with no
 * command. What a specifier means is the runner's to evaluate. Matchers,
 * conditions and commands are kept verbatim, placeholders included: a
 * hook's script sees tool names too, so nothing is rewritten at install.
 *
 * `${user_config.KEY}` in an exec-form handler (one with `args`) is a
 * reference to `KEY`, returned so a variable only a hook uses is not
 * reported as unreferenced.
 */

import type { ManifestSet, ResolvedHookSource } from "../detect.js";
import { describeValue, fields, isJsonObject, isStringArray, type JsonObject, parseJsonObject, readText } from "../documents.js";
import type { PluginFileIndex } from "../files.js";
import type { Findings } from "../messages.js";
import type { FindingContext, PluginWarningKind } from "../outcome.js";
import { userConfigReferences } from "../placeholders.js";
import type { HookFormat, PluginHookGroup, PluginHookHandler, PluginHooks } from "../types.js";

/** The events Stigmer runs, per format. */
export const RUN_EVENTS: Readonly<Record<HookFormat, ReadonlySet<string>>> = {
  "claude-code": new Set(["PreToolUse", "PostToolUse"]),
  cursor: new Set(["preToolUse", "beforeShellExecution", "beforeMCPExecution", "postToolUse", "afterMCPExecution"]),
};

/** Claude Code's exact-match matcher alphabet; any other character makes the matcher a regular expression. */
const CLAUDE_EXACT_MATCHER = /^[A-Za-z0-9_\- ,|]+$/;

/** A permission rule: `Tool` or `Tool(specifier)`. */
const CONDITION_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*(\([^\r\n]+\))?$/;

/** Top-level keys a hooks file may carry beside `hooks` without a warning. */
const FILE_KEYS: Readonly<Record<HookFormat, ReadonlySet<string>>> = {
  "claude-code": new Set(["hooks", "description"]),
  cursor: new Set(["hooks", "version"]),
};

const CLAUDE_GROUP_KEYS: ReadonlySet<string> = new Set(["matcher", "hooks"]);
const CLAUDE_HANDLER_KEYS: ReadonlySet<string> = new Set(["type", "command", "args", "timeout", "if", "async", "asyncRewake", "shell"]);
const CURSOR_HANDLER_KEYS: ReadonlySet<string> = new Set(["type", "command", "matcher", "timeout", "failClosed"]);

const FORMAT_NAMES: Readonly<Record<HookFormat, string>> = { "claude-code": "Claude Code's", cursor: "Cursor's" };

export interface HooksResult {
  /** The tool-call hooks read; absent when there are none. */
  readonly hooks?: PluginHooks;
  /** `${user_config.KEY}` names the carried handlers reference. */
  readonly references: ReadonlySet<string>;
}

/** What one source contributed, held until the plugin's run format is known. */
interface SourceRead {
  readonly path: string;
  /** `undefined` when the source has no event entries, so its format is moot. */
  readonly format: HookFormat | undefined;
  readonly groups: PluginHookGroup[];
  readonly warnings: { readonly kind: PluginWarningKind; readonly ctx: FindingContext }[];
  readonly references: string[];
}

export function normaliseHooks(index: PluginFileIndex, set: ManifestSet, findings: Findings): HooksResult {
  const reads: SourceRead[] = [];
  for (const source of set.hookSources) {
    const read = readSource(index, source, findings);
    if (read !== undefined) reads.push(read);
  }

  const carries = (format: HookFormat): boolean => reads.some((r) => r.format === format && r.groups.length > 0);
  const runFormat: HookFormat | undefined = carries("claude-code") ? "claude-code" : carries("cursor") ? "cursor" : undefined;

  const groups: PluginHookGroup[] = [];
  const references = new Set<string>();
  for (const read of reads) {
    if (read.format !== undefined && read.format !== runFormat && read.groups.length > 0) {
      findings.warn("hooks-format-not-run", { path: read.path, detail: FORMAT_NAMES[read.format] });
      continue;
    }
    for (const warning of read.warnings) findings.warn(warning.kind, warning.ctx);
    groups.push(...read.groups);
    for (const name of read.references) references.add(name);
  }

  return {
    ...(runFormat !== undefined && groups.length > 0 && { hooks: { format: runFormat, groups } }),
    references,
  };
}

function readSource(index: PluginFileIndex, source: ResolvedHookSource, findings: Findings): SourceRead | undefined {
  if (source.kind === "inline") {
    const path = `${source.manifest}#hooks`;
    if (source.format === "claude-code") return readEventMap(source.value, path, undefined, findings, true);
    return readFileShape(source.value, path, [source.format], findings);
  }
  if (!index.has(source.path)) {
    findings.warn("path-missing", { path: source.manifest, subject: `./${source.path}` });
    return undefined;
  }
  const text = readText(index, source.path, "hooks", findings);
  if (text === undefined) return undefined;
  const object = parseJsonObject(text, source.path, "hooks-unreadable", findings);
  if (object === undefined) return undefined;
  return readFileShape(object, source.path, source.formats, findings);
}

/** `{"hooks": {...}}`, with the format decided by the entries and checked against what the manifests read. */
function readFileShape(object: JsonObject, path: string, accepted: readonly HookFormat[], findings: Findings): SourceRead | undefined {
  const events = object["hooks"];
  if (!isJsonObject(events)) {
    findings.error("hooks-shape", {
      path,
      detail:
        events === undefined
          ? "a hooks file wraps its events in a top-level 'hooks' object"
          : "the top-level 'hooks' must be an object mapping events to their hooks",
    });
    return undefined;
  }
  const format = detectFormat(events, path, findings);
  if (format === null) return undefined;
  if (format !== undefined && !accepted.includes(format)) {
    findings.error("hooks-shape", {
      path,
      detail: `they are written in ${FORMAT_NAMES[format]} format, but the manifest that reads them expects ${accepted
        .map((f) => FORMAT_NAMES[f])
        .join(" or ")}`,
    });
    return undefined;
  }
  const read = readEventMap(events, path, format, findings, false);
  if (read === undefined) return undefined;
  const known = FILE_KEYS[format ?? "claude-code"];
  for (const [key] of fields(object)) {
    if (!known.has(key) && !(format === undefined && FILE_KEYS.cursor.has(key))) {
      read.warnings.push({ kind: "hook-field-ignored", ctx: { path, detail: key } });
    }
  }
  return read;
}

/**
 * The format an event map's entries are written in; `undefined` when it has
 * none, `null` after a `hooks-shape` finding.
 */
function detectFormat(events: JsonObject, path: string, findings: Findings): HookFormat | undefined | null {
  let claude = false;
  let cursor = false;
  for (const [event, entries] of fields(events)) {
    if (!Array.isArray(entries)) {
      findings.error("hooks-shape", { path, subject: event, detail: `the hooks on '${event}' must be an array` });
      return null;
    }
    for (const entry of entries) {
      if (!isJsonObject(entry)) {
        findings.error("hooks-shape", { path, subject: event, detail: `every entry on '${event}' must be an object` });
        return null;
      }
      if (entry["hooks"] !== undefined) claude = true;
      else cursor = true;
    }
  }
  if (claude && cursor) {
    findings.error("hooks-shape", { path, detail: "they mix Claude Code matcher groups with Cursor handlers" });
    return null;
  }
  return claude ? "claude-code" : cursor ? "cursor" : undefined;
}

/** An event map in a known (or moot) format into a source read. */
function readEventMap(
  events: JsonObject,
  path: string,
  format: HookFormat | undefined,
  findings: Findings,
  inline: boolean,
): SourceRead | undefined {
  if (inline) {
    // A bare map: its entries must be Claude Code groups.
    for (const [event, entries] of fields(events)) {
      if (!Array.isArray(entries)) {
        findings.error("hooks-shape", {
          path,
          subject: event,
          detail:
            event === "hooks" && isJsonObject(entries)
              ? "an inline hooks object is the event map itself, with no 'hooks' wrapper"
              : `the hooks on '${event}' must be an array`,
        });
        return undefined;
      }
      if (entries.some((entry) => !isJsonObject(entry) || !Array.isArray(entry["hooks"]))) {
        findings.error("hooks-shape", { path, subject: event, detail: `every entry on '${event}' must be a matcher group with a 'hooks' array` });
        return undefined;
      }
    }
    if (fields(events).some(([, entries]) => Array.isArray(entries) && entries.length > 0)) format = "claude-code";
  }
  const out: SourceRead = { path, format, groups: [], warnings: [], references: [] };
  if (format === undefined) return out;

  let refused = false;
  for (const [event, entries] of fields(events)) {
    const list = entries as readonly JsonObject[];
    if (list.length === 0) continue;
    if (!RUN_EVENTS[format].has(event)) {
      out.warnings.push({ kind: "hook-event-not-run", ctx: { path, subject: event } });
      if (format === "claude-code" && !checkClaudeGroupsShape(list, event, path, findings)) refused = true;
      continue;
    }
    for (const entry of list) {
      const ok = format === "claude-code" ? readClaudeGroup(entry, event, path, out, findings) : readCursorHandler(entry, event, path, out, findings);
      if (!ok) refused = true;
    }
  }
  return refused ? undefined : out;
}

/** A not-run event's groups still have to be groups. */
function checkClaudeGroupsShape(groups: readonly JsonObject[], event: string, path: string, findings: Findings): boolean {
  for (const group of groups) {
    if (!Array.isArray(group["hooks"]) || !group["hooks"].every(isJsonObject)) {
      findings.error("hooks-shape", { path, subject: event, detail: `a matcher group on '${event}' must hold a 'hooks' array of handlers` });
      return false;
    }
  }
  return true;
}

function readClaudeGroup(group: JsonObject, event: string, path: string, out: SourceRead, findings: Findings): boolean {
  const handlers = group["hooks"];
  if (!Array.isArray(handlers) || !handlers.every(isJsonObject)) {
    findings.error("hooks-shape", { path, subject: event, detail: `a matcher group on '${event}' must hold a 'hooks' array of handlers` });
    return false;
  }
  const matcher = readMatcher(group, event, path, "claude-code", findings);
  if (matcher === null) return false;
  for (const [key] of fields(group)) {
    if (!CLAUDE_GROUP_KEYS.has(key)) out.warnings.push({ kind: "hook-field-ignored", ctx: { path, subject: event, detail: key } });
  }
  let ok = true;
  const carried: PluginHookHandler[] = [];
  for (const handler of handlers) {
    const read = readClaudeHandler(handler, event, path, out, findings);
    if (read === null) ok = false;
    else if (read !== undefined) carried.push(read);
  }
  if (ok && carried.length > 0) out.groups.push({ event, matcher, handlers: carried });
  return ok;
}

/** A carried handler, `undefined` when it is warned as not run, `null` after an error. */
function readClaudeHandler(
  handler: JsonObject,
  event: string,
  path: string,
  out: SourceRead,
  findings: Findings,
): PluginHookHandler | undefined | null {
  const type = handler["type"] ?? "command";
  if (typeof type !== "string") {
    findings.error("hooks-shape", { path, subject: event, detail: "a handler's 'type' must be a string" });
    return null;
  }
  const notRun = (detail: string): undefined => {
    out.warnings.push({ kind: "hook-handler-not-run", ctx: { path, subject: event, detail } });
    return undefined;
  };
  if (type !== "command") return notRun(`its type is '${type}', and Stigmer runs command hooks`);
  if (handler["async"] === true) return notRun("it runs in the background ('async'), so it cannot decide a call");
  if (handler["asyncRewake"] === true) return notRun("it runs in the background ('asyncRewake'), so it cannot decide a call");

  const args = handler["args"] ?? [];
  if (!isStringArray(args)) {
    findings.error("hooks-shape", { path, subject: event, detail: "a handler's 'args' must be a list of strings" });
    return null;
  }
  if (handler["shell"] === "powershell" && args.length === 0) return notRun("it runs in PowerShell ('shell'), which the runner does not have");

  const command = readCommand(handler, event, path, findings);
  const timeout = readTimeout(handler, event, path, findings);
  const condition = readCondition(handler, event, path, findings);
  if (command === undefined || timeout === null || condition === null) return null;

  for (const [key] of fields(handler)) {
    if (!CLAUDE_HANDLER_KEYS.has(key)) out.warnings.push({ kind: "hook-field-ignored", ctx: { path, subject: event, detail: key } });
  }
  if (args.length > 0) {
    for (const value of [command, ...args]) out.references.push(...userConfigReferences(value));
  }
  return {
    command,
    args,
    ...(timeout !== undefined && { timeoutSeconds: timeout }),
    ...(condition !== undefined && { condition }),
    failClosed: false,
  };
}

function readCursorHandler(handler: JsonObject, event: string, path: string, out: SourceRead, findings: Findings): boolean {
  const type = handler["type"] ?? "command";
  if (typeof type !== "string") {
    findings.error("hooks-shape", { path, subject: event, detail: "a handler's 'type' must be a string" });
    return false;
  }
  if (type !== "command") {
    out.warnings.push({ kind: "hook-handler-not-run", ctx: { path, subject: event, detail: `its type is '${type}', and Stigmer runs command hooks` } });
    return true;
  }
  const command = readCommand(handler, event, path, findings);
  const matcher = readMatcher(handler, event, path, "cursor", findings);
  const timeout = readTimeout(handler, event, path, findings);
  const failClosed = handler["failClosed"] ?? false;
  if (typeof failClosed !== "boolean") {
    findings.error("hooks-shape", { path, subject: event, detail: "a handler's 'failClosed' must be true or false" });
    return false;
  }
  if (command === undefined || matcher === null || timeout === null) return false;
  for (const [key] of fields(handler)) {
    if (!CURSOR_HANDLER_KEYS.has(key)) out.warnings.push({ kind: "hook-field-ignored", ctx: { path, subject: event, detail: key } });
  }
  out.groups.push({
    event,
    matcher,
    handlers: [{ command, args: [], ...(timeout !== undefined && { timeoutSeconds: timeout }), failClosed }],
  });
  return true;
}

/** The command as written, or `undefined` after `hook-command-missing`. */
function readCommand(handler: JsonObject, event: string, path: string, findings: Findings): string | undefined {
  const command = handler["command"];
  if (typeof command !== "string" || command.trim() === "") {
    findings.error("hook-command-missing", { path, subject: event });
    return undefined;
  }
  return command;
}

/** The matcher as written (`""` when absent), or `null` after a finding. */
function readMatcher(object: JsonObject, event: string, path: string, format: HookFormat, findings: Findings): string | null {
  const matcher = object["matcher"] ?? "";
  if (typeof matcher !== "string") {
    findings.error("hooks-shape", { path, subject: event, detail: "a 'matcher' must be a string" });
    return null;
  }
  if (!isValidMatcher(matcher, format)) {
    findings.error("hook-matcher-invalid", { path, subject: event, detail: matcher });
    return null;
  }
  return matcher;
}

/**
 * True when a matcher means something in its format: every call (`""` or
 * `*`, in both), an exact list (Claude Code), or a regular expression
 * JavaScript compiles.
 */
export function isValidMatcher(matcher: string, format: HookFormat): boolean {
  if (matcher === "" || matcher === "*") return true;
  if (format === "claude-code" && CLAUDE_EXACT_MATCHER.test(matcher)) return true;
  try {
    new RegExp(matcher);
    return true;
  } catch {
    return false;
  }
}

/** Whole seconds, rounded up; `undefined` when absent, `null` after a finding. */
function readTimeout(handler: JsonObject, event: string, path: string, findings: Findings): number | undefined | null {
  const timeout = handler["timeout"];
  if (timeout === undefined) return undefined;
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 0 || timeout > 2 ** 31 - 1) {
    findings.error("hooks-shape", { path, subject: event, detail: `a handler's 'timeout' must be a number of seconds, not ${describeValue(timeout)}` });
    return null;
  }
  return Math.ceil(timeout);
}

/** The `if` as written; `undefined` when absent, `null` after a finding. */
function readCondition(handler: JsonObject, event: string, path: string, findings: Findings): string | undefined | null {
  const condition = handler["if"];
  if (condition === undefined) return undefined;
  if (typeof condition !== "string") {
    findings.error("hooks-shape", { path, subject: event, detail: "a handler's 'if' must be a string" });
    return null;
  }
  if (!CONDITION_PATTERN.test(condition)) {
    findings.error("hook-condition-invalid", { path, subject: event, detail: condition });
    return null;
  }
  return condition;
}
