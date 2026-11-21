// `stigmer coding-agent` (commands/coding-agent.ts) and the guide it prints
// (`@stigmer/coding-agent-plugin`'s skill). The guide is a script a coding
// agent runs, so it may name only what this CLI has: every `stigmer …`
// command line in it resolves to a registered command, and every flag it
// passes is one that command (or the root) declares. A renamed verb or flag
// fails here, in the CLI's own suite, before a release ships a guide that
// names it. The suite's title holds CLI-18 on the UX bar (test/ux-bar.json),
// with the commands' own suites and the scripted door
// (test/install/coding-agent-door.mjs).
//
// Every skill the plugin carries (skills/*/SKILL.md: the front door, the
// setup guide, the runs skill) is held the same way, and more tightly: a
// command line that goes past a group must go on to one of its commands, so a
// group followed by a word it does not have fails (`stigmer runs list` names
// the `runs` group and a word it lacks); a group named alone, in prose, is
// fine. So is its Claude Code guard (plugin/hooks/decide.mjs): its list of commands
// whose force flag skips a question or overwrites is exactly every command
// here with a `--force` option, each with the flags that mean force on it, and
// the approval command it asks before is this CLI's, answering allow unless
// told otherwise.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Command, Option } from "commander";
import { GUIDE } from "@stigmer/coding-agent-plugin";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../../program.js";
import { commandPath, runnableCommands } from "../../command-tree.js";
import { codingAgentGuide } from "../coding-agent.js";

/** Every `stigmer …` command line the guide names, from code spans and code blocks. */
function commandLines(guide: string): string[] {
  const spans = [...guide.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].flatMap((m) => m[1]?.split("\n") ?? []);
  const inline = [...guide.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");
  return [...spans, ...inline]
    // A pipe or && between commands separates them; one inside a `<a|b>` placeholder does not.
    .flatMap((text) => text.split(/\s*(?:\|(?![^<]*>)|&&)\s*/))
    .map((text) => text.trim().replace(/^!\s*/, ""))
    .filter((text) => /^stigmer\s+\S/.test(text));
}

function optionNames(command: Command): string[] {
  return command.options.flatMap((option: Option) => [option.long, option.short].filter((n): n is string => n !== undefined));
}

/** The command a line resolves to and the flags it passes, or the word that matched no command. */
function resolveLine(program: Command, line: string): { command?: Command; unknownWord?: string; flags: string[] } {
  const words = line.split(/\s+/).slice(1);
  let command = program;
  const flags: string[] = [];
  let positional = false;
  for (const word of words) {
    if (word.startsWith("-")) {
      flags.push(word.split("=")[0] ?? word);
      continue;
    }
    if (positional) continue;
    const sub = command.commands.find((c) => c.name() === word || c.aliases().includes(word));
    if (sub !== undefined) {
      command = sub;
    } else if (command.commands.length > 0 && command === program) {
      return { unknownWord: word, flags };
    } else {
      positional = true;
    }
  }
  return { command, flags };
}

describe("CLI-18 the guide stigmer coding-agent prints names only commands and flags this CLI has", () => {
  const program = buildProgram();
  const lines = commandLines(GUIDE);

  it("names commands at all (the extraction works)", () => {
    expect(lines.length).toBeGreaterThan(20);
    expect(lines).toContain("stigmer version");
  });

  it.each(commandLines(GUIDE))("%s is a command this CLI has, with flags it declares", (line) => checkLine(program, line));
});

describe("codingAgentGuide", () => {
  it("says what it is and which CLI wrote it, then the guide", () => {
    const text = codingAgentGuide("# Set up Stigmer for this project\n\nStep one.\n\n", "0.2.0");
    expect(text).toBe(
      "Stigmer CLI 0.2.0: the guide for a coding agent. Follow it step by step, asking the person where it says to.\n\n" +
        "# Set up Stigmer for this project\n\nStep one.\n",
    );
  });
});

const pluginRoot = new URL("../../../../../coding-agents/plugin/", import.meta.url);
const FRONT_DOOR = readFileSync(fileURLToPath(new URL("skills/stigmer/SKILL.md", pluginRoot)), "utf8");

/** Assert a guide's command line resolves to a command this CLI has, passing only flags it declares. */
function checkLine(program: Command, line: string): void {
  const resolved = resolveLine(program, line);
  expect(resolved.unknownWord, `"${line}" names no stigmer command`).toBeUndefined();
  const command = resolved.command as Command;
  expect(command, line).not.toBe(program);
  const known = new Set([...optionNames(command), ...optionNames(program)]);
  for (let parent = command.parent; parent !== null; parent = parent.parent) {
    for (const name of optionNames(parent)) known.add(name);
  }
  for (const flag of resolved.flags) {
    expect(known.has(flag), `"${line}": ${flag} is not a flag of stigmer ${command.name()}`).toBe(true);
  }
}

describe("the plugin's front door names only commands and flags this CLI has", () => {
  const program = buildProgram();
  const lines = commandLines(FRONT_DOOR);

  it("names commands at all", () => {
    expect(lines).toContain("stigmer docs search <words>");
    expect(lines).toContain("stigmer auth whoami");
  });

  it.each(lines)("%s", (line) => checkLine(program, line));
});

describe("every skill the plugin carries names only commands that run, with flags they declare", () => {
  const program = buildProgram();
  const runnable = new Set(runnableCommands(program));
  const skills = readdirSync(fileURLToPath(new URL("skills/", pluginRoot)));
  const lines = skills.flatMap((skill) =>
    commandLines(readFileSync(fileURLToPath(new URL(`skills/${skill}/SKILL.md`, pluginRoot)), "utf8")).map(
      (line) => [skill, line] as const,
    ),
  );

  it("reads every skill, the runs and integration skills' commands among them", () => {
    expect(skills.sort()).toEqual(["stigmer", "stigmer-integrate", "stigmer-run", "stigmer-setup"]);
    expect(lines.map(([, line]) => line)).toContain("stigmer list runs --agent invoice-checker --limit 5");
    expect(lines.map(([, line]) => line)).toContain("stigmer app-handover --stack <nextjs|node|python|go|java> --agent <agent> --write .");
  });

  it.each(lines)("%s: %s", (_skill, line) => {
    checkLine(program, line);
    const command = resolveLine(program, line).command as Command;
    const pathWords = commandPath(command).split(" ").length;
    const words = line.split(/\s+/).filter((word) => !word.startsWith("-")).length;
    if (words > pathWords) {
      expect(runnable.has(command), `"${line}" goes past \`${commandPath(command)}\`, a group, with a word it has no command for`).toBe(true);
    }
  });
});

interface Guard {
  FORCE_COMMANDS: Array<{ path: string[]; flags: string[] }>;
  APPROVE_COMMAND: { path: string[]; flag: string };
}

describe("the plugin's guard knows every command a force flag pushes past its question", () => {
  const program = buildProgram();

  it("lists exactly the commands with a --force option, with the flags that mean force", async () => {
    const guard = (await import(new URL("hooks/decide.mjs", pluginRoot).href)) as Guard;
    const forced = runnableCommands(program)
      .map((command) => ({ command, force: command.options.find((option) => option.long === "--force") }))
      .filter((entry) => entry.force !== undefined)
      .map(({ command, force }) => ({
        path: commandPath(command).split(" ").slice(1),
        flags: [force?.short, force?.long].filter((flag): flag is string => flag !== undefined),
      }));
    const key = (entry: { path: string[] }) => entry.path.join(" ");
    expect(forced.length).toBeGreaterThan(5);
    expect([...guard.FORCE_COMMANDS].sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
      forced.sort((a, b) => key(a).localeCompare(key(b))),
    );
  });

  it("asks before the approval command this CLI has, which answers allow by default", async () => {
    const guard = (await import(new URL("hooks/decide.mjs", pluginRoot).href)) as Guard;
    const approve = runnableCommands(program).find((command) => commandPath(command) === `stigmer ${guard.APPROVE_COMMAND.path.join(" ")}`);
    const action = approve?.options.find((option) => option.long === guard.APPROVE_COMMAND.flag);
    expect(action?.defaultValue).toBe("allow");
  });
});
