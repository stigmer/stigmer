What a good answer may also say. Never graded: leaving any of it out fails nothing.

- Only the Organization's admins add a server, by either route.
- A server in the Agent's own `mcp_servers` is reached over HTTP only.
- `disallowed_tools` removes tools and is applied first.
- `stigmer connect plugin <name>` or **Check tools** lists the live server's tools and marks the destructive ones (for a plugin's server; an Agent's own servers can't be listed yet).
- A tool the server marks `destructiveHint: true` asks for approval before it runs.
- `--dry-run` previews the plugin without installing it.
- The exact forms: `mcp__plugin_<plugin>_<server>__get_shipment` and `mcp__plugin_<plugin>_<server>__list_carriers` for a plugin's server (a server added with `stigmer mcp add` has the plugin's name), or `mcp__<server>__get_shipment` and `mcp__<server>__list_carriers` for a server in the Agent's own `mcp_servers`.
- `stigmer mcp add <name> https://tools.harborline.example/mcp --header 'Authorization=Bearer ${SOME_TOKEN}'`, then the plugin in the Agent's `plugins` or **Add to an agent**; an Agent's own `mcp_servers` entry takes a name, url and headers.
- Saving the token with `stigmer vault set-secret SOME_TOKEN --mine`, or in a shared vault.
