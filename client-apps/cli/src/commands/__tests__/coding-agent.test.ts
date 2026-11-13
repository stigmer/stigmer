// `stigmer coding-agent` (commands/coding-agent.ts) and the guide it prints
// (`@stigmer/coding-agent-plugin`'s skill). The guide is a script a coding
// agent runs, so it may name only what this CLI has: every `stigmer …`
// command line in it resolves to a registered command, and every flag it
// passes is one that command (or the root) declares. A renamed verb or flag
// fails here, in the CLI's own suite, before a release ships a guide that
// names it. The suite's title holds CLI-18 on the UX bar (test/ux-bar.json),
// with the commands' own suites and the scripted door
// (test/install/coding-agent-door.mjs).

import type { Command, Option } from "commander";
import { GUIDE } from "@stigmer/coding-agent-plugin";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../../program.js";
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

  it.each(commandLines(GUIDE))("%s is a command this CLI has, with flags it declares", (line) => {
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
  });
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
