/**
 * Pins how a hook group's matcher and a handler's `if` select calls, as
 * Claude Code's hooks and permissions pages describe them (read 2026-10-05):
 *  - the matcher: every call, an exact list, or an unanchored expression;
 *  - `Bash(...)`: any simple command of the input, quotes understood,
 *    substitutions and subshells reached, wrappers and assignments peeled,
 *    `*` any text and a trailing ` *` (or `:*`) also the bare command;
 *  - `Read`/`Edit` paths, gitignore-style, against the real absolute path;
 *  - `WebFetch(domain:…)`, `Agent(type)`, `Tool(param:value)`, MCP rules;
 *  - the safety rule: whatever the matcher cannot be sure of matches, so the
 *    hook runs and decides; a word the shell expands is such a thing, and
 *    only the words before it can rule a command out;
 *  - `*` is matched in linear time, whatever the rule and the input.
 */

import { describe, expect, it } from "vitest";
import { conditionMatches, wildcardMatch } from "../condition.js";
import { matcherMatches } from "../matcher.js";
import { splitShellCommands } from "../shell-commands.js";
import type { ToolView } from "../tool-view.js";

const CTX = { workspaceRoot: "/ws", homeDir: "/home/me" };

const bash = (command: string): ToolView => ({ toolName: "Bash", toolInput: { command } });
const file = (toolName: string, path: string): ToolView => ({ toolName, toolInput: { file_path: path } });

describe("matcherMatches", () => {
  it.each([
    ["", "Bash", true],
    ["*", "mcp__github__create_issue", true],
    ["Bash", "Bash", true],
    ["Bash", "BashOutput", false],
    ["Write|Edit", "Edit", true],
    ["Write, Edit", "Edit", true],
    ["Write|Edit", "Read", false],
    ["mcp__github__.*", "mcp__github__create_issue", true],
    ["mcp__github__.*", "mcp__gitlab__create_issue", false],
    ["Notebook.*", "NotebookEdit", true],
    ["^Read$", "Read", true],
    ["(unclosed", "Read", false],
  ])("matcher %j on %s is %s", (matcher, toolName, expected) => {
    expect(matcherMatches(matcher, toolName)).toBe(expected);
  });
});

describe("conditionMatches: Bash rules (any subcommand)", () => {
  it.each([
    ["Bash(npm run build)", "npm run build", true],
    ["Bash(npm run build)", "npm run build --watch", false],
    ["Bash(npm run test *)", "npm run test", true],
    ["Bash(npm run test *)", "npm run test --coverage", true],
    ["Bash(npm run test:*)", "npm run test", true],
    ["Bash(npm run test:*)", "npm run test unit", true],
    ["Bash(git *)", "git", true],
    ["Bash(git * main)", "git push origin main", true],
    ["Bash(git push *)", "git status", false],
    ["Bash(git push *)", "npm test && git push origin main", true],
    ["Bash(git push *)", "npm test || git push", true],
    ["Bash(git push *)", "make; git push", true],
    ["Bash(git push *)", "echo hi | git push", true],
    ["Bash(git push *)", "echo hi |& git push", true],
    ["Bash(git push *)", "sleep 1 & git push", true],
    ["Bash(git push *)", "make\ngit push", true],
    ["Bash(git push *)", "echo $(git push origin)", true],
    ["Bash(git push *)", "echo `git push origin`", true],
    ["Bash(git push *)", "(cd repo && git push)", true],
    ["Bash(git push *)", "echo \"$(git push)\"", true],
    ["Bash(git push *)", "echo 'git push'", false],
    ["Bash(git push *)", "timeout 30 git push origin", true],
    ["Bash(git push *)", "nice -n 5 git push", true],
    ["Bash(git push *)", "nohup git push", true],
    ["Bash(git push *)", "GIT_TRACE=1 git push", true],
    ["Bash(git push *)", "FOO=1 BAR=2 command git push", true],
    ["Bash(git push *)", "xargs git push", true],
    ["Bash(git push *)", "xargs -n1 git push", false],
    ["Bash(rm -rf *)", "cmd 2>&1 && rm -rf build", true],
    ["Bash(rm -rf *)", "rm  -rf   build", true],
    ["Bash(rm -rf *)", 'rm -rf "my dir"', true],
    ["Bash(curl *)", "bash -c 'curl example.com'", true],
  ])("%s on %j is %s", (rule, command, expected) => {
    expect(conditionMatches(rule, bash(command), CTX)).toBe(expected);
  });

  it.each([
    ["an unbalanced quote", "echo 'unterminated"],
    ["a heredoc", "cat <<EOF\nhi\nEOF"],
    ["eval", "eval \"$CMD\""],
    ["sh -c over a variable", "sh -c \"$CMD\""],
    ["an unmatched bracket", "echo )"],
  ])("matches when it cannot parse %s, so the hook runs", (_what, command) => {
    expect(conditionMatches("Bash(git push *)", bash(command), CTX)).toBe(true);
  });

  it.each([
    ["a variable as the command", "x=rm; $x -rf build", "Bash(rm *)", true],
    ["a substitution as the command", "$(echo rm) -rf build", "Bash(rm *)", true],
    ["a glob as the command", "r? -rf build", "Bash(rm *)", true],
    ["a home path as the command", "~/bin/rm -rf build", "Bash(rm *)", true],
    ["a variable after a matching prefix", "git push origin $BRANCH", "Bash(git push origin main)", true],
    ["a variable that may expand to nothing", "rm $FLAGS", "Bash(rm)", true],
    ["a variable after a prefix the rule rules out", "echo $HOME", "Bash(git push *)", false],
    ["a variable after a wrong subcommand", "git status $X", "Bash(git push *)", false],
  ])("judges %s by the words before it", (_what, command, rule, expected) => {
    expect(conditionMatches(rule, bash(command), CTX)).toBe(expected);
  });

  it("matches a call with no command string", () => {
    expect(conditionMatches("Bash(git push *)", { toolName: "Bash", toolInput: {} }, CTX)).toBe(true);
  });
});

describe("conditionMatches: tools and shapes", () => {
  it("a bare tool name matches only that tool", () => {
    expect(conditionMatches("Bash", bash("ls"), CTX)).toBe(true);
    expect(conditionMatches("Write", bash("ls"), CTX)).toBe(false);
  });

  it("reads Task as Agent", () => {
    expect(conditionMatches("Task", { toolName: "Agent", toolInput: {} }, CTX)).toBe(true);
  });

  it("a rule it cannot read matches", () => {
    expect(conditionMatches("not a rule!", bash("ls"), CTX)).toBe(true);
  });

  it("an empty or `*` specifier is the whole tool", () => {
    expect(conditionMatches("Bash()", bash("anything"), CTX)).toBe(true);
    expect(conditionMatches("Bash(*)", bash("anything"), CTX)).toBe(true);
  });
});

describe("conditionMatches: Read and Edit paths (gitignore-style)", () => {
  it.each([
    ["Read(./.env)", "Read", "/ws/.env", true],
    ["Read(./.env)", "Read", "/ws/sub/.env", false],
    ["Read(.env)", "Read", "/ws/sub/.env", true],
    ["Read(*.env)", "Read", "/ws/a/b/prod.env", true],
    ["Read(/secrets/**)", "Read", "/ws/secrets/key.pem", true],
    ["Read(/secrets/**)", "Read", "/ws/public/key.pem", false],
    ["Read(//etc/passwd)", "Read", "/etc/passwd", true],
    ["Read(~/.ssh/**)", "Read", "/home/me/.ssh/id_rsa", true],
    ["Read(src/)", "Read", "/ws/src/index.ts", true],
    ["Read(./secrets)", "Read", "/ws/secrets/key.pem", true],
    ["Edit(src/**/*.ts)", "Edit", "/ws/src/a/b.ts", true],
    ["Edit(src/**/*.ts)", "Write", "/ws/src/a/b.ts", true],
    ["Edit(src/**/*.ts)", "Write", "/ws/lib/b.ts", false],
  ])("%s on %s %s is %s", (rule, toolName, path, expected) => {
    expect(conditionMatches(rule, file(toolName, path), CTX)).toBe(expected);
  });

  it("a Read rule on a search matches: what a search reads cannot be bounded", () => {
    expect(conditionMatches("Read(./.env)", { toolName: "Grep", toolInput: { pattern: "x", path: "/ws" } }, CTX)).toBe(true);
  });

  it("a Read rule does not govern a shell command", () => {
    expect(conditionMatches("Read(./.env)", bash("cat .env"), CTX)).toBe(false);
  });

  it("a call with no path matches", () => {
    expect(conditionMatches("Read(./.env)", { toolName: "Read", toolInput: {} }, CTX)).toBe(true);
  });
});

describe("conditionMatches: WebFetch, Agent, arguments, MCP", () => {
  const fetch = (url: unknown): ToolView => ({ toolName: "WebFetch", toolInput: { url } });

  it.each([
    ["WebFetch(domain:example.com)", "https://example.com/a", true],
    ["WebFetch(domain:example.com)", "https://api.example.com/a", false],
    ["WebFetch(domain:*.example.com)", "https://api.example.com/a", true],
    ["WebFetch(domain:*.example.com)", "https://evilexample.com/a", false],
    ["WebFetch(domain:EXAMPLE.com)", "https://example.COM", true],
  ])("%s on %s is %s", (rule, url, expected) => {
    expect(conditionMatches(rule, fetch(url), CTX)).toBe(expected);
  });

  it("a call with no URL matches", () => {
    expect(conditionMatches("WebFetch(domain:example.com)", { toolName: "WebFetch", toolInput: {} }, CTX)).toBe(true);
  });

  it("a URL it cannot parse matches", () => {
    expect(conditionMatches("WebFetch(domain:example.com)", fetch("not a url"), CTX)).toBe(true);
  });

  it("Agent(type) ignores case, and a call naming no type matches", () => {
    const agent = (subagent_type: unknown): ToolView => ({ toolName: "Agent", toolInput: { subagent_type } });
    expect(conditionMatches("Agent(Explore)", agent("explore"), CTX)).toBe(true);
    expect(conditionMatches("Agent(explore)", agent("shell"), CTX)).toBe(false);
    expect(conditionMatches("Agent(explore)", agent(undefined), CTX)).toBe(true);
  });

  it("Tool(param:value) reads a top-level argument with `*` as any text", () => {
    const grep = (args: Record<string, unknown>): ToolView => ({ toolName: "Grep", toolInput: args });
    expect(conditionMatches("Grep(output_mode:content)", grep({ output_mode: "content" }), CTX)).toBe(true);
    expect(conditionMatches("Grep(pattern:TODO*)", grep({ pattern: "TODO(me)" }), CTX)).toBe(true);
    expect(conditionMatches("Grep(output_mode:content)", grep({ output_mode: "files" }), CTX)).toBe(false);
    expect(conditionMatches("Grep(output_mode:content)", grep({}), CTX)).toBe(false);
    expect(conditionMatches("Grep(nested:x)", grep({ nested: { a: 1 } }), CTX)).toBe(true);
    expect(conditionMatches("Grep(no colon)", grep({}), CTX)).toBe(true);
  });

  it("MCP rules match a server's tools or one tool", () => {
    const mcp: ToolView = { toolName: "mcp__github__create_issue", toolInput: {} };
    expect(conditionMatches("mcp__github", mcp, CTX)).toBe(true);
    expect(conditionMatches("mcp__github__*", mcp, CTX)).toBe(true);
    expect(conditionMatches("mcp__github__create_issue", mcp, CTX)).toBe(true);
    expect(conditionMatches("mcp__github__close_issue", mcp, CTX)).toBe(false);
    expect(conditionMatches("mcp__gitlab", mcp, CTX)).toBe(false);
  });
});

describe("wildcardMatch", () => {
  it.each([
    ["", "", true],
    ["", "a", false],
    ["*", "", true],
    ["a*c", "abbbc", true],
    ["a*c", "abbb", false],
    ["*b*", "abc", true],
    ["a**", "a", true],
    ["a.c", "abc", false],
    ["(x)", "(x)", true],
  ])("%j on %j is %s", (pattern, text, expected) => {
    expect(wildcardMatch(pattern, text)).toBe(expected);
  });

  it("answers a many-star rule over a long near-miss quickly", () => {
    const started = performance.now();
    expect(wildcardMatch("*a*a*a*a*a*a*a*a*b", "a".repeat(20_000))).toBe(false);
    expect(conditionMatches(`Bash(${"x * ".repeat(12)}y)`, bash(`x ${"x ".repeat(5_000)}`), CTX)).toBe(false);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("splitShellCommands", () => {
  it("returns each simple command's words with quotes removed", () => {
    const commands = splitShellCommands(`git commit -m "fix: it's done" && echo 'a b'`);
    expect(commands?.map((words) => words.map((w) => w.text))).toEqual([
      ["git", "commit", "-m", "fix: it's done"],
      ["echo", "a b"],
    ]);
  });

  it("marks a word that expands as not literal", () => {
    const [words] = splitShellCommands(`echo "$HOME" plain`) ?? [];
    expect(words?.map((w) => w.literal)).toEqual([true, false, true]);
  });

  it("reads escapes and line continuations", () => {
    const commands = splitShellCommands("echo a\\ b \\\nc");
    expect(commands?.[0]?.map((w) => w.text)).toEqual(["echo", "a b", "c"]);
  });

  it("does not descend into arithmetic", () => {
    const commands = splitShellCommands("echo $((1 + 2))");
    expect(commands?.length).toBe(1);
  });

  it("reaches commands inside quotes, escapes and nested brackets", () => {
    const reaches = (line: string) =>
      splitShellCommands(line)?.some((words) => words.map((w) => w.text).join(" ") === "git push") ?? null;
    expect(reaches('echo "run `git push`"')).toBe(true);
    expect(reaches("echo $(echo \\) && git push)")).toBe(true);
    expect(reaches("echo $(echo 'a)b' && git push)")).toBe(true);
    expect(reaches('echo $(echo "a)\\"b" && git push)')).toBe(true);
    expect(reaches("echo `echo \\`x\\` ; git push`")).toBe(true);
    expect(reaches("bash -c 'git push'")).toBe(true);
  });

  it("reads escapes inside double quotes as the shell does", () => {
    const [words] = splitShellCommands('echo "a \\"b\\" \\$c" plain*') ?? [];
    expect(words?.map((w) => w.text)).toEqual(["echo", 'a "b" $c', "plain*"]);
    expect(words?.map((w) => w.literal)).toEqual([true, true, false]);
  });

  it.each([
    ["a nested eval", "echo $(eval x)"],
    ["an interpreter over an eval", "bash -c 'eval x'"],
    ["an open subshell", "(echo hi"],
    ["an open substitution inside quotes", 'echo "$(open"'],
    ["an open backtick inside quotes", 'echo "`open"'],
    ["an open quote inside a substitution", "echo $(echo 'a)"],
    ["an open double quote inside a substitution", 'echo $(echo "a)'],
    ["nesting deeper than it follows", `echo ${"$(echo ".repeat(10)}x${")".repeat(10)}`],
  ])("gives up on %s", (_what, line) => {
    expect(splitShellCommands(line)).toBeNull();
  });

  it("gives up on unbalanced input", () => {
    expect(splitShellCommands("echo $(unclosed")).toBeNull();
    expect(splitShellCommands('echo "open')).toBeNull();
    expect(splitShellCommands("echo `open")).toBeNull();
    expect(splitShellCommands("trailing \\")).toBeNull();
  });
});
