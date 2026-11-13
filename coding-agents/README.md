# Stigmer's plugin for coding agents

`@stigmer/coding-agent-plugin`: one plugin for Claude Code, Codex and Cursor,
and the guide a coding agent follows to set Stigmer up for a person's project.
It is the "Let your coding agent set it up" door
(`docs/getting-started/coding-agent.mdx`).

This is not `plugins/`, the catalogue Stigmer installs into its own agents. This
one is for the coding agent on a person's laptop.

## What is in it

- `plugin/skills/stigmer/SKILL.md`: the guide. `stigmer coding-agent` prints it
  without its frontmatter (`client-apps/cli/src/commands/coding-agent.ts`), so
  a person who pastes the prompt gets the guide released with the CLI they
  installed.
- `plugin/.mcp.json`: the bundled `stigmer mcp-server`, for making, running and
  reading agents once setup is done.
- The manifests and marketplace files of each tool, one plugin named `stigmer`
  at the folder's root: `.claude-plugin/` (Claude Code), `.cursor-plugin/`
  (Cursor), `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`
  (Codex).

## Build, publish, install

`npm run build` (`scripts/build.mjs`) copies `plugin/` to `dist/plugin/`,
stamps each manifest's `version` with the package's, writes `dist/index.js`
(`GUIDE`, `VERSION`, `PLUGIN_REPOSITORY`), and fails if `npm pack` would leave
a staged file out. The release train publishes the package with the other
libraries, before the CLI that depends on it (`scripts/publish-libs.mjs`).

`reconcile-coding-agent-plugin.yaml` then makes the public repository
`stigmer/coding-agent-plugin` equal to the npm `latest` package's
`dist/plugin/`, the way `reconcile-homebrew.yaml` keeps the tap. People install
from that repository; the install lines are on the docs page.

## Tests

`npm run test -w @stigmer/coding-agent-plugin` builds the package and reads it
with Stigmer's own plugin reader (`@stigmer/plugin-package`), which knows all
three dialects: every manifest names the one plugin at the package's version,
the skill and the MCP server read with no warning, and each marketplace file
offers the plugin at the root. The CLI's suite holds the guide to the CLI
(`client-apps/cli/src/commands/__tests__/coding-agent.test.ts`): every
`stigmer …` line it names is a command this CLI has, with flags it declares.
Run both after a change here. The door end to end, in a real coding agent, is
`make door-coding-agent` (`test/install/coding-agent-door.mjs`), by hand.
