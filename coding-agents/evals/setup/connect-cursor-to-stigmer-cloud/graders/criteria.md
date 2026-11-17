---
type: llm
---

PASS if the answer gives one of the documented ways, with its steps: (a) the hosted MCP connector at `https://mcp.stigmer.ai`: create a Stigmer API key in the console under Settings → API Keys (shown only once), add a `stigmer` entry under `mcpServers` in `.cursor/mcp.json` (or `~/.cursor/mcp.json` for every repository) with that URL and an `Authorization: Bearer <key>` header, reload Cursor, see it under Settings → MCP, and check it by asking Cursor to list the agents; or (b) Stigmer's plugin for Cursor (cloned into `~/.cursor/plugins/local/stigmer`, then Developer: Reload Window), which carries the guide as a skill and the local `stigmer mcp-server`, using the command line's own sign-in. It must treat the API key like a password: never committed to a repository (so a repository-level `mcp.json` holding it stays out of git) and never pasted into a chat. Welcome but optional: `stigmer mcp-server` runs on stdio and reads the active backend from the CLI's config; Claude Desktop signs in through the browser instead of a key.

FAIL if it invents an endpoint, a Cursor marketplace listing or a setting the docs don't name; tells them to commit the key or put it in a shared file; asks for the key in the chat or prints one; or says Cursor connects through the browser sign-in.
