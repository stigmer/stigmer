---
type: llm
---

PASS if the answer says the plugin is used as it is: Stigmer reads a Claude Code (or Cursor, or Codex) plugin folder unchanged, and:
- `stigmer validate -f <dir>` reads the folder offline and says what would install (skills, hooks, subagents, MCP servers, variables) and what Stigmer skips;
- an Organization admin installs it with `stigmer push plugin <dir>` (or `stigmer apply` on the folder, or the console);
- the Agent gets it by listing the plugin in its `plugins` (or **Add to an agent**), which attaches it whole: its Skills, hooks, subagents and MCP servers; the plugin's Skills are named `<plugin>:<skill>` and are not added through `skill_refs`;
- the `PreToolUse` command hook runs before tool calls on Stigmer (it can refuse, ask, or allow), in Claude Code's format, on every harness; Stigmer runs command hooks on tool calls only, so hooks for other events (such as `Stop` or `UserPromptSubmit`) and non-command hooks are listed as not run.

Welcome but optional: a reference with no version follows the latest pushed version from the next turn; `stigmer run --plugin <name>` tries it in one conversation first; hook files in a repository (`.claude/settings.json`) never run for the Agent; a plugin's page lists every hook command it runs.

FAIL if it says the skills or hooks must be rewritten or converted to another format; says the plugin's Skills attach through `skill_refs`; invents commands the docs don't name (such as `stigmer plugin install` or `stigmer plugin add`); claims every hook event runs; or says hooks in the repository's `.claude/settings.json` apply to the Agent.
