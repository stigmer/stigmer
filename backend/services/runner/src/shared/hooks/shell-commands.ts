/**
 * Split a shell command line into the simple commands it runs, for matching
 * a `Bash(...)` permission rule against each (`condition.ts`).
 *
 * Claude Code matches a Bash rule against every subcommand: it splits on
 * `&&`, `||`, `;`, `|`, `|&`, `&` and newlines, and reaches into subshells
 * and command substitutions. This is a small scanner for exactly that, not
 * a shell: it understands quotes and escapes, collects `$( )`, backticks
 * and a leading `( )` as nested command lines, and returns each simple
 * command as its words with the quotes removed. The shell's own words that
 * open or close a compound command (`if`, `then`, `do`, `{`, `!`, `fi`,
 * `done`, `}` and the rest) are not commands: they are dropped, so
 * `if true; then rm -rf build; fi` runs `true` and `rm -rf build`. A
 * script another program runs is scanned as one more command line: a
 * shell's `-c` script (`bash -c`, `bash -lc`, `/bin/sh -ec`, behind a
 * wrapper or not), the `-c` or `--command` script of `su`, `runuser`,
 * `script` and `flock`, and the action of `trap 'action' SIGNAL…`.
 *
 * Each command says whether it is as written: run by the line itself, at
 * its top, in a `$( )`, a backtick or a `( )` subshell, or in the `-c`
 * script of a shell named first in its command, by its bare name, with
 * nothing before it (`bash -c '…'`). Any other runner's script, a shell's
 * behind a wrapper, an assignment or a path (`sudo bash -c`, `PATH=x bash
 * -c`, `/tmp/x/bash -c`), a `trap` action (it runs later, in whatever
 * state the line left), and everything nested inside one are not: another
 * program decides what runs, as with a wrapper (`condition.ts`).
 *
 * A word is literal only when the shell would run it as written. An
 * unquoted `$`, glob character (`*`, `?`, `[`), `~`, brace (`{a,b}`
 * expands) or redirection (`>out` before a command) makes it not literal,
 * and the caller treats such a word as possibly anything.
 *
 * Its one safety rule: what it cannot be sure it understood answers `null`,
 * and the caller then runs the hook. An unbalanced quote or bracket, a
 * heredoc, `eval`, a `function` definition, arithmetic that runs a command
 * (`$(( $(…) ))`), and a `-c` script or a `trap` action that is anything but
 * a literal string are all `null`. Matching too widely runs a hook more often and the
 * hook still decides; matching too narrowly would skip a policy.
 */

/** One word of a simple command. */
export interface ShellWord {
  /** The word with its quotes and escapes removed. */
  readonly text: string;
  /** False when the shell would expand something in it (`$`, a substitution, unquoted `*`). */
  readonly literal: boolean;
}

/** A simple command: its words, in order, and whether the line runs it as written. */
export interface ShellCommand {
  readonly words: readonly ShellWord[];
  /** False when another program runs it: a script behind a wrapper, `su`'s, a `trap` action. */
  readonly asWritten: boolean;
}

/** The shells: each runs its `-c` script itself. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** The programs that run a `-c` script, beside the shells. */
const SCRIPT_RUNNERS = new Set([
  ...SHELLS,
  // The target user's login shell runs it.
  "su",
  "runuser",
  // `$SHELL -c` runs it (util-linux; BSD `script` takes words, `condition.ts`).
  "script",
  // `sh -c` runs it.
  "flock",
]);

/** Words that open or continue a compound command before the command it runs. */
const OPENING_WORDS = new Set(["if", "then", "elif", "else", "do", "while", "until", "!", "{", "coproc"]);

/** Words that close a compound command, and run nothing. */
const CLOSING_WORDS = new Set(["fi", "done", "}", "esac"]);

/** A short option word that includes `c`: `-c`, `-lc`, `-ec`. Linear: the word is the model's. */
function isScriptFlag(word: string): boolean {
  return /^-[A-Za-z]+$/.test(word) && word.includes("c");
}

const LONG_SCRIPT_FLAG = "--command";

/** Every simple command `line` runs, nested ones included; `null` when it cannot be sure. */
export function splitShellCommands(line: string): readonly ShellCommand[] | null {
  const out: ShellCommand[] = [];
  return collect(line, out, 0, true) ? out : null;
}

/** How deep nested command lines may go before the scanner gives up. */
const MAX_DEPTH = 8;

function collect(line: string, out: ShellCommand[], depth: number, asWritten: boolean): boolean {
  if (depth > MAX_DEPTH) return false;
  const scanned = scan(line);
  if (scanned === null) return false;
  for (const nested of scanned.nested) {
    if (!collect(nested, out, depth + 1, asWritten)) return false;
  }
  for (const words of scanned.commands) {
    const command = withoutCompoundWords(words);
    if (command.length === 0) continue;
    if (command[0]!.text === "eval" || command[0]!.text === "function") return false;
    const script = runnerScript(command);
    if (script === null) return false;
    if (script !== undefined && !collect(script.text, out, depth + 1, asWritten && script.asWritten)) return false;
    const action = trapAction(command);
    if (action === null) return false;
    if (action !== undefined && !collect(action, out, depth + 1, false)) return false;
    out.push({ words: command, asWritten });
  }
  return true;
}

/** A simple command without the compound command's own words around it. */
function withoutCompoundWords(words: readonly ShellWord[]): readonly ShellWord[] {
  let start = 0;
  while (start < words.length && OPENING_WORDS.has(words[start]!.text)) start += 1;
  let end = words.length;
  while (end > start && CLOSING_WORDS.has(words[end - 1]!.text)) end -= 1;
  return words.slice(start, end);
}

/**
 * The script a runner in this command runs with `-c` or `--command`:
 * `undefined` when there is none, `null` when there is one it cannot read
 * (not literal, or missing). The runner may sit behind a wrapper or be named
 * by path, so any word naming one counts; its script is as written only for
 * a shell that is the command's first word, by its bare name.
 */
function runnerScript(command: readonly ShellWord[]): { readonly text: string; readonly asWritten: boolean } | null | undefined {
  const runner = command.findIndex((word) => SCRIPT_RUNNERS.has(word.text.slice(word.text.lastIndexOf("/") + 1)));
  if (runner === -1) return undefined;
  const flag = command.findIndex(
    (word, i) => i > runner && (isScriptFlag(word.text) || word.text === LONG_SCRIPT_FLAG || word.text.startsWith(`${LONG_SCRIPT_FLAG}=`)),
  );
  if (flag === -1) return undefined;
  const flagWord = command[flag]!;
  const inline = flagWord.text.startsWith(`${LONG_SCRIPT_FLAG}=`);
  const script = inline ? { text: flagWord.text.slice(LONG_SCRIPT_FLAG.length + 1), literal: flagWord.literal } : command[flag + 1];
  if (script === undefined || !script.literal || script.text.startsWith("-")) return null;
  const head = command[0]!;
  return { text: script.text, asWritten: runner === 0 && head.literal && SHELLS.has(head.text) };
}

/**
 * The action of `trap [-lp] [--] action SIGNAL…`, as bash's `help trap`
 * reads it: `undefined` when the command is not a `trap` that sets one (it
 * lists, or a single operand resets that signal), `null` when the action is
 * not literal.
 */
function trapAction(command: readonly ShellWord[]): string | null | undefined {
  if (command[0]!.text !== "trap" || !command[0]!.literal) return undefined;
  let first = 1;
  if (command[first]?.text === "--") first += 1;
  else if (command[first]?.text.startsWith("-") && command[first]!.text !== "-") return undefined;
  if (command.length - first < 2) return undefined;
  const action = command[first]!;
  return action.literal ? action.text : null;
}

interface Scanned {
  readonly commands: ShellWord[][];
  readonly nested: string[];
}

/** One pass over a command line: its simple commands and the nested lines to scan next. */
function scan(line: string): Scanned | null {
  const commands: ShellWord[][] = [];
  const nested: string[] = [];
  let words: ShellWord[] = [];
  let text = "";
  let literal = true;
  let inWord = false;

  const endWord = (): void => {
    if (inWord) words.push({ text, literal });
    text = "";
    literal = true;
    inWord = false;
  };
  const endCommand = (): void => {
    endWord();
    commands.push(words);
    words = [];
  };

  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    const next = line[i + 1];

    if (c === "\\") {
      if (next === undefined) return null;
      if (next !== "\n") {
        text += next;
        inWord = true;
      }
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) return null;
      text += line.slice(i + 1, end);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      const quoted = scanDoubleQuoted(line, i + 1, nested);
      if (quoted === null) return null;
      text += quoted.text;
      literal &&= quoted.literal;
      inWord = true;
      i = quoted.end + 1;
      continue;
    }
    if (c === "`") {
      const end = closingBacktick(line, i + 1);
      if (end === -1) return null;
      nested.push(line.slice(i + 1, end));
      text += line.slice(i, end + 1);
      literal = false;
      inWord = true;
      i = end + 1;
      continue;
    }
    if (c === "$" && next === "(") {
      const end = closingParen(line, i + 1);
      if (end === -1) return null;
      if (line[i + 2] !== "(") nested.push(line.slice(i + 2, end));
      else if (arithmeticRunsCommands(line.slice(i + 3, end))) return null;
      text += line.slice(i, end + 1);
      literal = false;
      inWord = true;
      i = end + 1;
      continue;
    }
    if (c === "(" && !inWord && words.length === 0) {
      const end = closingParen(line, i);
      if (end === -1) return null;
      nested.push(line.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (c === ")") return null;
    if (c === "<" && next === "<") return null;
    if (c === "&" && (text.endsWith(">") || text.endsWith("<"))) {
      text += c;
      i += 1;
      continue;
    }
    if (c === ";" || c === "\n" || c === "&" || c === "|") {
      endCommand();
      i += next === "&" || next === "|" || (c === ";" && next === ";") ? 2 : 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      endWord();
      i += 1;
      continue;
    }
    if ("$*?[~{}<>".includes(c)) literal = false;
    text += c;
    inWord = true;
    i += 1;
  }
  endCommand();
  return { commands, nested };
}

/** The text inside `"..."` from `start`, its closing quote's index, and whether it expands anything. */
function scanDoubleQuoted(
  line: string,
  start: number,
  nested: string[],
): { readonly text: string; readonly end: number; readonly literal: boolean } | null {
  let text = "";
  let literal = true;
  let i = start;
  while (i < line.length) {
    const c = line[i]!;
    if (c === '"') return { text, end: i, literal };
    if (c === "\\" && i + 1 < line.length && '"\\$`\n'.includes(line[i + 1]!)) {
      if (line[i + 1] !== "\n") text += line[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const end = closingBacktick(line, i + 1);
      if (end === -1) return null;
      nested.push(line.slice(i + 1, end));
      text += line.slice(i, end + 1);
      literal = false;
      i = end + 1;
      continue;
    }
    if (c === "$" && line[i + 1] === "(") {
      const end = closingParen(line, i + 1);
      if (end === -1) return null;
      if (line[i + 2] !== "(") nested.push(line.slice(i + 2, end));
      else if (arithmeticRunsCommands(line.slice(i + 3, end))) return null;
      text += line.slice(i, end + 1);
      literal = false;
      i = end + 1;
      continue;
    }
    if (c === "$") literal = false;
    text += c;
    i += 1;
  }
  return null;
}

/**
 * Whether `$(( … ))` text runs a command: bash expands substitutions inside
 * arithmetic, and the scanner does not take them apart there, so one makes
 * the line unsure.
 */
function arithmeticRunsCommands(text: string): boolean {
  return text.includes("$(") || text.includes("`");
}

/** The index of the `)` closing the `(` at `open`, skipping quoted text; -1 when unbalanced. */
function closingParen(line: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < line.length) {
    const c = line[i]!;
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      const end = closingDoubleQuote(line, i + 1);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (c === "(") depth += 1;
    if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function closingDoubleQuote(line: string, start: number): number {
  let i = start;
  while (i < line.length) {
    if (line[i] === "\\") {
      i += 2;
      continue;
    }
    if (line[i] === '"') return i;
    i += 1;
  }
  return -1;
}

function closingBacktick(line: string, start: number): number {
  let i = start;
  while (i < line.length) {
    if (line[i] === "\\") {
      i += 2;
      continue;
    }
    if (line[i] === "`") return i;
    i += 1;
  }
  return -1;
}
