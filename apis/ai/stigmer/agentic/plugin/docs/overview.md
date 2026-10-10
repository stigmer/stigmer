A Plugin is an installed Agent Plugins package, the unit of install, upgrade and
removal for a set of skills, agents, hooks and MCP servers, and the only home of
an MCP server. Pushing a plugin folder in the Agent Plugins, Cursor, Claude Code
or Codex layout stores the plugin alone, and its status lists what the archive
holds. An agent or a conversation uses a plugin by listing it in `plugins`, and
gets it whole: its skills as `<plugin>:<skill>`, its agents as sub-agents named
`<plugin>:<agent>`, its hooks, and its MCP servers, whose tools are
`mcp__plugin_<plugin>_<server>__<tool>`.

A plugin is not authored as YAML. Its spec is read from the package manifest;
the folder below is what `stigmer push plugin ./thermos` sends, and
`stigmer mcp add <name> <url>` builds and pushes a plugin of one server.

```text
thermos/
  .cursor-plugin/plugin.json      # name, version, description, author
  skills/thermos/SKILL.md         # one entry in status.skills per SKILL.md
  agents/reviewer.md              # one entry in status.agents
  mcp.json                        # one entry in status.mcp_servers per server
  hooks/hooks.json                # tool-call hooks, recorded on status.hooks
```

The resulting resource, as `stigmer get plugin thermos -o yaml` renders it:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Plugin
metadata:
  name: thermos
  slug: thermos
spec:
  name: thermos
  version: "1.2.0"
  description: "Code review with a thermonuclear standard"
  dialect: PLUGIN_DIALECT_CURSOR
status:
  digest: "3f8c1d2e9b7a4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5"
  skills:
    - name: thermos
      description: "Review a change against the team's standard"
      path: skills/thermos
  agents:
    - name: reviewer
      description: "Reviews one pull request"
      instructions: "You review pull requests..."
      tools: [Read, Grep, mcp__plugin_thermos_linear]
  mcp_servers:
    - name: linear
      http:
        url: https://mcp.linear.app/mcp
        headers:
          Authorization: "Bearer ${LINEAR_ACCESS_TOKEN}"
      env: [LINEAR_ACCESS_TOKEN]
      sign_in:
        oauth_only: true
  env:
    LINEAR_ACCESS_TOKEN:
      description: "Your Linear login"
      is_secret: true
```

A server at an address with no key in its headers is probed at install; one that
answers with an OAuth challenge records `sign_in.oauth_only` and a login key, as
above, and a person signs in once from the plugin's page or with
`stigmer connect plugin`. `PluginCommandController.listTools` lists a server's
tools as the caller and stores nothing. Hooks the plugin carries but Stigmer
does not run, and an `ai.stigmer/` folder (no longer read;
`stigmer-folder-ignored`), are named in `status.warnings`. Deleting a plugin is
refused while an agent of the organization lists it.
