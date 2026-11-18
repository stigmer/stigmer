What a good answer may also say. Never graded: leaving any of it out fails nothing.

- The key is shown only once and starts with `stk_`.
- After the reload the connector appears in Cursor under Settings → MCP, and asking Cursor to list the agents checks it works.
- `stigmer mcp-server` runs on stdio and reads the active backend from the CLI's config (`~/.stigmer/config.yaml`).
- The plugin also carries the setup guide as a skill, and shows under Customize after the reload.
- Claude Desktop signs in through the browser instead of a key.
- The connector's steps: a key created in the console under Settings → API Keys, a `stigmer` entry under `mcpServers` in `.cursor/mcp.json` (or `~/.cursor/mcp.json` for every repository) with an `Authorization: Bearer <key>` header, then reloading Cursor.
- The plugin's steps: clone it into `~/.cursor/plugins/local/stigmer` and run Developer: Reload Window, with the command line installed and signed in.
