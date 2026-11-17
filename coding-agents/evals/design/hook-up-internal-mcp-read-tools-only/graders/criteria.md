---
type: llm
---

PASS if the answer gives a documented way to attach the server and to narrow its tools:
- Either add it as a plugin holding that one server, with `stigmer mcp add <name> https://tools.harborline.example/mcp --header 'Authorization=Bearer ${SOME_TOKEN}'` (or **Add MCP server** under **Library → Plugins**), then list that plugin in the Agent's `plugins` (or **Add to an agent**); or write it in the Agent's own `mcp_servers` (name, url, headers; HTTP only). Either way only the Organization's admins add a server.
- The token is never written into the header or the instructions: the header names it as `${NAME}`, and its value is saved in a vault (for example `stigmer vault set-secret SOME_TOKEN --mine`, or a shared vault), found by name when a run starts.
- The Agent's `tools` list keeps only the two read tools, in Claude Code's names: `mcp__plugin_<plugin>_<server>__get_shipment` and `__list_carriers` for a plugin's server (a server added with `stigmer mcp add` has the plugin's name), or `mcp__<server>__get_shipment` for a server in the Agent's own `mcp_servers`; `disallowed_tools` removes tools and is applied first.

Welcome but optional: `stigmer connect plugin <name>` or **Check tools** lists the live server's tools and marks the destructive ones; a tool the server marks `destructiveHint: true` asks for approval; `--dry-run` previews the plugin.

FAIL if it pastes the literal token into a header, the instructions or a plugin file; invents commands or fields the docs don't name (such as `stigmer tool add`, `stigmer mcp connect`, a `token:` field on the server); gets the tool-name form wrong in a way that would not match (for example bare `get_shipment` in `tools`); or claims a parenthesised specifier narrows a tool to some calls.
