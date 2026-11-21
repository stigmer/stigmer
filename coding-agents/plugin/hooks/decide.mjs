// What the plugin's guard decides about one call: ask the person first, or
// say nothing and let the coding agent's own permissions decide. The
// decision is the tool's own (reasonFor); each coding agent's side reads its
// hook input and writes its answer: decide() for Claude Code's PreToolUse
// hook (guard.mjs), decideCursor() for Cursor's beforeMCPExecution and
// beforeShellExecution hooks (cursor-guard.mjs). Codex's hooks cannot ask,
// so Codex asks from the tool server's own marks instead.
//
// It asks before an act that can't be undone, or that is the person's to
// give, even when they once chose "always allow" for the plugin's tools:
//
//   - the plugin's own tool server's destructive tools (every tool marked
//     destructiveHint in @stigmer/mcp-server), named the way Claude Code
//     names a plugin's server's tools, mcp__plugin_<plugin>_<server>__<tool>;
//   - answering a run's approval with allow or allow_all (a deny passes:
//     refusing is always safe), by the tool or by `stigmer runs approve`;
//   - a `stigmer` command whose --force skips the CLI's own confirmation or
//     overwrites files. A plain `stigmer delete` passes: without a terminal
//     the CLI's own question aborts it. `-f` is matched only on those
//     commands, since it means --file on `apply` and --follow on `logs`.
//
// Both lists are held by tests against their sources (the tool server's
// roster, the CLI's command tree), so a new destructive tool or forced
// command can't ship unguarded. The reason is written for two readers: the
// person, who sees it in the prompt, and the agent, which reads it in the
// tool result when no one is there to answer (a `claude -p` run denies an
// `ask` and hands the agent the reason).
//
// Pure, and dependency-free: the plugin installs from GitHub with no
// node_modules.

/** The tool server's destructive tools, as the hook's matcher names them. */
export const DESTRUCTIVE_TOOLS = ["delete_agent", "delete_skill", "cancel_run"];

/** The tool that answers a run's approval. */
export const APPROVAL_TOOL = "submit_run_approval";

/** How Claude Code names this plugin's server's tools. */
export const TOOL_PREFIX = "mcp__plugin_stigmer_stigmer__";

/**
 * The `mcp_server_name` Cursor gives this plugin's tool server: a plugin's
 * server is `plugin-<plugin folder>-<server>` (measured on Cursor's CLI
 * 2026.11.19, the folder the install line clones into being `stigmer`), and
 * a person's own `mcp.json` entry for `stigmer mcp-server` is `stigmer`.
 * Another server's tools are never this guard's to judge.
 */
export const CURSOR_SERVER_NAMES = ["stigmer", "plugin-stigmer-stigmer"];

/**
 * The CLI commands whose force flag skips a confirmation or overwrites,
 * each with the flags that mean force on it.
 */
export const FORCE_COMMANDS = [
  { path: ["delete"], flags: ["-f", "--force"] },
  { path: ["provider-key", "delete"], flags: ["-f", "--force"] },
  { path: ["service-account", "delete"], flags: ["-f", "--force"] },
  { path: ["vault", "remove-secret"], flags: ["-f", "--force"] },
  { path: ["vault", "remove-connection"], flags: ["-f", "--force"] },
  { path: ["reset"], flags: ["--force"] },
  { path: ["example", "get"], flags: ["-f", "--force"] },
  { path: ["app-handover"], flags: ["-f", "--force"] },
];

/** The CLI command that answers a run's approval, and its flag naming the answer. */
export const APPROVE_COMMAND = { path: ["runs", "approve"], flag: "--action" };

/** Global options that take a value, so the value is never read as a command word. */
const VALUE_GLOBALS = new Set(["--org", "--api-key"]);

const AGENT_LINE = "If the person hasn't approved exactly this in the conversation, stop and ask them first.";

/**
 * Why to ask before one call, whichever coding agent makes it, or null:
 * `{ kind: "tool", name, args }` for a tool of this plugin's server (`name`
 * bare, as the server names it), `{ kind: "shell", command }` for a shell
 * line. Throws only on hostile input; each side catches.
 */
export function reasonFor(call) {
  if (call.kind === "shell") return shellReason(call.command);
  if (call.kind === "tool") return toolReason(call.name, call.args);
  return null;
}

/**
 * Claude Code's side: the answer to one PreToolUse input, an `ask` with its
 * reason, or `null` to say nothing. Never throws.
 */
export function decide(input) {
  try {
    if (input === null || typeof input !== "object") return null;
    const tool = typeof input.tool_name === "string" ? input.tool_name : "";
    const args = input.tool_input !== null && typeof input.tool_input === "object" ? input.tool_input : {};
    if (tool === "Bash") {
      const command = typeof args.command === "string" ? args.command : "";
      const reason = reasonFor({ kind: "shell", command });
      return reason === null ? null : ask(reason);
    }
    if (!tool.startsWith(TOOL_PREFIX)) return null;
    const reason = reasonFor({ kind: "tool", name: tool.slice(TOOL_PREFIX.length), args });
    return reason === null ? null : ask(reason);
  } catch {
    return null;
  }
}

/**
 * Cursor's side: the answer to one beforeMCPExecution or
 * beforeShellExecution input, `{ permission: "ask", user_message,
 * agent_message }`, or `{}` to say nothing. Cursor hands `tool_input` as a
 * JSON string and the tool's bare name, beside the server's name. Never
 * throws. Cursor asks the person in its window; a run that allows every
 * command (`--force`) passes over an ask, which is the person's own choice.
 */
export function decideCursor(input) {
  try {
    if (input === null || typeof input !== "object") return {};
    let reason = null;
    if (input.hook_event_name === "beforeShellExecution") {
      reason = reasonFor({ kind: "shell", command: typeof input.command === "string" ? input.command : "" });
    } else if (input.hook_event_name === "beforeMCPExecution") {
      if (!CURSOR_SERVER_NAMES.includes(input.mcp_server_name)) return {};
      const name = typeof input.tool_name === "string" ? input.tool_name : "";
      reason = reasonFor({ kind: "tool", name, args: toolInput(input.tool_input) });
    }
    return reason === null ? {} : { permission: "ask", user_message: reason, agent_message: `${reason} ${AGENT_LINE}` };
  } catch {
    return {};
  }
}

/** Cursor's `tool_input`: a JSON string, read as an object; anything else is no arguments. */
function toolInput(raw) {
  if (raw !== null && typeof raw === "object") return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function ask(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: `${reason} ${AGENT_LINE}`,
    },
  };
}

function text(value) {
  return typeof value === "string" && value !== "" ? value : "?";
}

function named(args) {
  const org = typeof args.org === "string" && args.org !== "" ? `${args.org}/` : "";
  return `${org}${text(args.slug)}`;
}

/** The reason to ask before one of the tool server's tools, or null. */
function toolReason(name, args) {
  switch (name) {
    case "delete_agent":
      return `Stigmer: this deletes the agent ${named(args)} and every version of it. It can't be undone.`;
    case "delete_skill":
      return `Stigmer: this deletes the skill ${named(args)} and every version of it. It can't be undone.`;
    case "cancel_run":
      return `Stigmer: this cancels run ${text(args.run_id)}: every unfinished turn of its conversation stops, and can't be resumed.`;
    case APPROVAL_TOOL: {
      const decision = args.decision;
      if (decision !== "allow" && decision !== "allow_all") return null;
      return `Stigmer: this answers run ${text(args.run_id)}'s approval with "${decision}", and the run then goes ahead. An approval is the person's to give.`;
    }
    default:
      return DESTRUCTIVE_TOOLS.includes(name) ? `Stigmer: ${name} can't be undone.` : null;
  }
}

/** The reason to ask before a shell line, or null: the first `stigmer` command in it that needs asking. */
export function shellReason(line) {
  for (const words of commands(line)) {
    const at = words.findIndex(isStigmer);
    if (at === -1) continue;
    const rest = words.slice(at + 1);
    const path = commandWords(rest);
    const shown = words.slice(at).join(" ");
    const forced = FORCE_COMMANDS.find((entry) => startsWith(path, entry.path));
    if (forced !== undefined && rest.some((word) => isForceFlag(word, forced.flags))) {
      return `Stigmer: \`${shown}\` skips the CLI's own question with --force, and what it deletes or overwrites can't be undone.`;
    }
    if (startsWith(path, APPROVE_COMMAND.path)) {
      const answer = optionValue(rest, APPROVE_COMMAND.flag) ?? "allow";
      if (answer !== "deny") {
        return `Stigmer: \`${shown}\` answers a run's approval with "${answer}", and the run then goes ahead. An approval is the person's to give.`;
      }
    }
  }
  return null;
}

/** Whether a word runs the stigmer CLI: `stigmer`, a path to it, or the npm package. */
function isStigmer(word) {
  const base = word.split("/").pop() ?? "";
  return base === "stigmer" || base === "stigmer.exe" || /^@stigmer\/cli(@.*)?$/.test(word);
}

/** The command words after `stigmer`: every word that is not a flag or a global flag's value. */
function commandWords(rest) {
  const words = [];
  for (let i = 0; i < rest.length; i += 1) {
    const word = rest[i];
    if (word === "--") break;
    if (word.startsWith("-")) {
      if (VALUE_GLOBALS.has(word)) i += 1;
      continue;
    }
    words.push(word);
  }
  return words;
}

function startsWith(words, prefix) {
  return prefix.every((word, i) => words[i] === word);
}

function isForceFlag(word, flags) {
  if (flags.includes(word)) return true;
  if (flags.includes("--force") && word.startsWith("--force=")) return word !== "--force=false";
  // A cluster of short flags (`-yf`) carries -f too.
  return flags.includes("-f") && /^-[A-Za-z]{2,}$/.test(word) && word.includes("f");
}

function optionValue(words, flag) {
  for (let i = 0; i < words.length; i += 1) {
    if (words[i] === flag) return words[i + 1];
    if (words[i].startsWith(`${flag}=`)) return words[i].slice(flag.length + 1);
  }
  return undefined;
}

/**
 * A shell line's simple commands, each as its words: split at `;`, `&`,
 * `|`, `&&`, `||`, newlines and parentheses outside quotes, with quotes
 * removed. Leading `VAR=value` assignments are dropped. Not a full shell
 * parser: a line it misreads at worst asks once more than it needs to.
 */
export function commands(line) {
  const out = [];
  let words = [];
  let word = "";
  let inWord = false;
  let quote = "";
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    const start = words.findIndex((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    if (start !== -1) out.push(words.slice(start));
    words = [];
  };
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote !== "") {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && i + 1 < line.length) word += line[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === "\\" && i + 1 < line.length) {
      word += line[++i];
      inWord = true;
    } else if (c === " " || c === "\t") {
      endWord();
    } else if (c === ";" || c === "&" || c === "|" || c === "\n" || c === "(" || c === ")") {
      endCommand();
    } else {
      word += c;
      inWord = true;
    }
  }
  endCommand();
  return out;
}
