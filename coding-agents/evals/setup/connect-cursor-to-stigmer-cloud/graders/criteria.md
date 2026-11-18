---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Names a documented way to connect Cursor to Stigmer Cloud: the hosted Stigmer MCP connector at `https://mcp.stigmer.ai`, or Stigmer's plugin for Cursor, which runs the local `stigmer mcp-server` on the command line's own sign-in.
- Gives that way's setup in substance: for the connector, a Stigmer API key and a Cursor MCP entry with that URL and a bearer header; for the plugin, installing it locally with the CLI signed in.
- Where it uses an API key, says to treat it like a password: never committed (a repository's `mcp.json` holding it stays out of git) and never shared in plain text, such as in a chat.

**FAIL if**

- It invents an endpoint, a Cursor marketplace listing or a setting the docs don't name.
- It tells them to commit the key or put it in a shared file.
- It asks for the key in the chat or prints one.
- It says Cursor connects through the browser sign-in.

**Welcome**

- The key is shown only once and starts with `stk_`.
- After the reload the connector appears in Cursor under Settings → MCP, and asking Cursor to list the agents checks it works.
- `stigmer mcp-server` runs on stdio and reads the active backend from the CLI's config (`~/.stigmer/config.yaml`).
- The plugin also carries the setup guide as a skill, and shows under Customize after the reload.
- Claude Desktop signs in through the browser instead of a key.
- The connector's steps: a key created in the console under Settings → API Keys, a `stigmer` entry under `mcpServers` in `.cursor/mcp.json` (or `~/.cursor/mcp.json` for every repository) with an `Authorization: Bearer <key>` header, then reloading Cursor.
- The plugin's steps: clone it into `~/.cursor/plugins/local/stigmer` and run Developer: Reload Window, with the command line installed and signed in.
