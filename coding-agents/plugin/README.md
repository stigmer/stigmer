# Stigmer for coding agents

This repository is published from [stigmer/stigmer](https://github.com/stigmer/stigmer)'s
`coding-agents/` folder at each release; change it there.

Stigmer is in Beta: things may change, and your work is kept. Tell us what
breaks. What Beta means, and the bar for lifting it: https://stigmer.ai/docs/beta

Stigmer runs AI agents for the users of your own product. This plugin makes your
coding agent Stigmer's expert, in Claude Code, Codex and Cursor. Ask it in plain
words, and it:

- **answers any question about Stigmer** (what it is, whether it fits, the
  editions, pricing, how it compares) from the live docs at stigmer.ai/docs, and
  links the page it read;
- **sets Stigmer up for your project**: signing in, an agent for your app's users,
  a first run, and the agent's chat in your own app;
- **designs and builds agents**: instructions, skills, tools and MCP servers,
  approvals, secrets, channels such as Slack and WhatsApp, routines;
- **runs, fixes and checks them**: runs an agent on a file in your project, reads
  what a run did and why it failed, answers an approval, scores runs before you
  ship a change;
- **puts them in your product**: calls from your backend in TypeScript, Python, Go
  or Java, the chat in your React app, one organization per customer, your users'
  sign-in;
- **runs your own server and organization**: Docker, Compose or Kubernetes, sign-in
  with your identity provider, runners, upgrades, roles, keys for CI, usage.

It asks you before anything that can't be undone or is yours to give: deleting an
agent or skill, cancelling a run, answering a run's approval, or a `stigmer`
command forced past its own question. It never asks for a key in the chat.

## Install

It needs the Stigmer command line: `npm install -g @stigmer/cli` (or
`brew install stigmer/tap/stigmer`), signed in with `stigmer auth login`, or
`stigmer up` for a local Stigmer.

- **Claude Code**: `claude plugin install stigmer --marketplace stigmer/coding-agent-plugin`
- **Codex**: `codex plugin marketplace add stigmer/coding-agent-plugin`, then
  `codex plugin add stigmer@stigmer`
- **Cursor**: `git clone https://github.com/stigmer/coding-agent-plugin ~/.cursor/plugins/local/stigmer`,
  then Reload Window

You don't need the plugin to start. Paste this into your coding agent:

> Set up Stigmer for this project. Install its command line
> (`npm install -g @stigmer/cli`, or `brew install stigmer/tap/stigmer`), run
> `stigmer coding-agent`, and follow what it prints.

An app with no terminal, such as Claude Desktop, connects to Stigmer Cloud's
hosted server instead: https://stigmer.ai/docs/guides/editors/connect-mcp

## What it runs and what it reaches

- **The `stigmer` command line**, which you install. The plugin starts its tool
  server (`stigmer mcp-server`), and your coding agent runs `stigmer` commands.
  Both act on the Stigmer you signed the command line in to: Stigmer Cloud
  (`*.stigmer.ai`), your own server at its own address, or `stigmer up` on your
  machine. They use that sign-in; the plugin holds no credential.
- **stigmer.ai**, for the docs it reads and cites.
- **A Node script** that reads the call your coding agent is about to make and, for
  the acts above, asks you first: `hooks/guard.mjs` in Claude Code, for the tool
  server's tools and `stigmer` commands; `hooks/cursor-guard.mjs` in Cursor, for
  `stigmer` commands, where Cursor's own tool approval covers the tool server's
  tools. It reads nothing else, writes nothing and reaches no network. Codex asks
  from the tools' own marks.
- **Skills**: Markdown instructions your coding agent reads.

Nothing else. The manifest's `network.hosts` names stigmer.ai; your own server's
address is whatever you signed in to.

Docs: https://stigmer.ai/docs/guides/editors/connect-mcp · Privacy:
https://stigmer.ai/privacy · Issues: https://github.com/stigmer/stigmer/issues
