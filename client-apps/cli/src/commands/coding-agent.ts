// `stigmer coding-agent` — the guide a coding agent follows to set Stigmer up
// for the project it is in.
//
// The door for people who work in Claude Code, Codex or Cursor: they paste one
// prompt that installs this CLI and runs this command, and their coding agent
// follows what it prints, from signing in to the agent's chat in their own
// app. The text is the skill of Stigmer's plugin for coding agents
// (`@stigmer/coding-agent-plugin`), a dependency released with this CLI, so
// the guide a person's coding agent reads always names the commands and flags
// of the CLI they installed. The same file is the plugin's skill, installed
// from its own repository for next time.

import type { Command } from "commander";
import { VERSION } from "../version.js";

export function registerCodingAgent(program: Command): void {
  program
    .command("coding-agent")
    .description("print the guide a coding agent follows to set Stigmer up for your project")
    .action(async () => {
      const { GUIDE } = await import("@stigmer/coding-agent-plugin");
      process.stdout.write(codingAgentGuide(GUIDE, VERSION));
    });
}

/** The printed guide: one line that says what it is, then the guide. Pure. */
export function codingAgentGuide(guide: string, version: string): string {
  const header = `Stigmer CLI ${version}: the guide for a coding agent. Follow it step by step, asking the person where it says to.`;
  return `${header}\n\n${guide.trimEnd()}\n`;
}
