---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Attaches the server by a documented route, for example as a plugin holding it (`stigmer mcp add` or **Add MCP server** in the console) listed in the Agent's `plugins`, or in the Agent's own `mcp_servers`.
- Keeps the token out of the header and the instructions: the header names a variable (for example `Authorization=Bearer ${NAME}`) whose value is saved in a vault and found by name when a run starts.
- Limits the Agent to only `get_shipment` and `list_carriers`, for example through its `tools` list, naming each in the full MCP tool-name form that matches the route chosen (such as `mcp__<server>__get_shipment`).

**FAIL if**

- It pastes the literal token into a header, the instructions or a plugin file.
- It invents commands or fields the docs don't name, such as `stigmer tool add`, `stigmer mcp connect`, or a `token:` field on the server.
- It gets the tool-name form wrong in a way that would not match, for example bare `get_shipment` in `tools`.
- It claims a parenthesised specifier narrows a tool to some calls.

**Welcome**

- Only the Organization's admins add a server, by either route.
- A server in the Agent's own `mcp_servers` is reached over HTTP only.
- `disallowed_tools` removes tools and is applied first.
- `stigmer connect plugin <name>` or **Check tools** lists the live server's tools and marks the destructive ones (for a plugin's server; an Agent's own servers can't be listed yet).
- A tool the server marks `destructiveHint: true` asks for approval before it runs.
- `--dry-run` previews the plugin without installing it.
- The exact forms: `mcp__plugin_<plugin>_<server>__get_shipment` and `mcp__plugin_<plugin>_<server>__list_carriers` for a plugin's server (a server added with `stigmer mcp add` has the plugin's name), or `mcp__<server>__get_shipment` and `mcp__<server>__list_carriers` for a server in the Agent's own `mcp_servers`.
- `stigmer mcp add <name> https://tools.harborline.example/mcp --header 'Authorization=Bearer ${SOME_TOKEN}'`, then the plugin in the Agent's `plugins` or **Add to an agent**; an Agent's own `mcp_servers` entry takes a name, url and headers.
- Saving the token with `stigmer vault set-secret SOME_TOKEN --mine`, or in a shared vault.
