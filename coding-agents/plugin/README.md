# Stigmer for coding agents

This repository is published from [stigmer/stigmer](https://github.com/stigmer/stigmer)'s
`coding-agents/` folder at each release; change it there.

It is one plugin for Claude Code, Codex and Cursor: a skill that sets Stigmer up
for the project your coding agent is in (signing in, an agent for your app's
users, a first run, and the agent's chat in your own app), and Stigmer's MCP
server (`stigmer mcp-server`) for making, running and reading agents afterwards.
It needs the Stigmer command line: `npm install -g @stigmer/cli`.

You don't need the plugin to start. Paste this into your coding agent:

> Set up Stigmer for this project. Install its command line
> (`npm install -g @stigmer/cli`, or `brew install stigmer/tap/stigmer`), run
> `stigmer coding-agent`, and follow what it prints.

## Install

- **Claude Code**: `claude plugin install stigmer --marketplace stigmer/coding-agent-plugin`
- **Codex**: `codex plugin marketplace add stigmer/coding-agent-plugin`, then
  `codex plugin add stigmer@stigmer`
- **Cursor**: `git clone https://github.com/stigmer/coding-agent-plugin ~/.cursor/plugins/local/stigmer`,
  then Reload Window

Guide: https://stigmer.ai/docs/getting-started/coding-agent
