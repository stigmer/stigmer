What a good answer may also say. Never graded: leaving any of it out fails nothing.

- `stigmer validate -f <dir>` reads the folder offline and says what would install (skills, hooks, subagents, MCP servers, variables) and what Stigmer skips.
- The plugin's Skills are named `<plugin>:<skill>` and are not added through `skill_refs`.
- Listing the plugin also brings its subagents and MCP servers.
- Stigmer runs command hooks on tool calls only, so hooks for other events (such as `Stop` or `UserPromptSubmit`) and non-command hooks are listed as not run.
- The hook can also ask, or allow, and runs on every harness.
- A reference with no version follows the latest pushed version from the next turn.
- `stigmer run --plugin <name>` tries it in one conversation first.
- Hook files in a repository (`.claude/settings.json`) never run for the Agent.
- A plugin's page lists every hook command it runs.
