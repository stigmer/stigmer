---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says the plugin is used as it is, with nothing rewritten: Stigmer reads a Claude Code (or Cursor, or Codex) plugin folder unchanged, its skills and its `hooks.json` included.
- Says an Organization admin installs the folder as a plugin, for example with `stigmer push plugin <dir>`, `stigmer apply` on the folder, or the console.
- Says the Agent gets it by listing the plugin (for example in its `plugins`, or **Add to an agent**), which attaches it whole, its Skills and hooks with it.
- Says the `PreToolUse` command hook runs before tool calls on Stigmer, in Claude Code's format, and can refuse the call.

**FAIL if**

- It says the skills or hooks must be rewritten or converted to another format.
- It says the plugin's Skills attach through `skill_refs`.
- It invents commands the docs don't name, such as `stigmer plugin install` or `stigmer plugin add`.
- It claims every hook event runs.
- It says hooks in the repository's `.claude/settings.json` apply to the Agent.

**Welcome**

- `stigmer validate -f <dir>` reads the folder offline and says what would install (skills, hooks, subagents, MCP servers, variables) and what Stigmer skips.
- The plugin's Skills are named `<plugin>:<skill>` and are not added through `skill_refs`.
- Listing the plugin also brings its subagents and MCP servers.
- Stigmer runs command hooks on tool calls only, so hooks for other events (such as `Stop` or `UserPromptSubmit`) and non-command hooks are listed as not run.
- The hook can also ask, or allow, and runs on every harness.
- A reference with no version follows the latest pushed version from the next turn.
- `stigmer run --plugin <name>` tries it in one conversation first.
- Hook files in a repository (`.claude/settings.json`) never run for the Agent.
- A plugin's page lists every hook command it runs.
