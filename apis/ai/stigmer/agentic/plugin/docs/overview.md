A Plugin is an installed Agent Plugins package: the unit of install, upgrade and
removal for a set of skills, MCP servers, an agent and workflows. A plugin is
what you install; an agent is what runs. Pushing a plugin folder in the Agent
Plugins, Cursor, Claude Code or Codex layout materialises ordinary Stigmer
resources in the organization, each labelled with the plugin's id, and the
plugin's status reports what the push produced.

A plugin is not authored as YAML. Its spec is read from the package manifest;
the folder below is what `stigmer push plugin ./thermos` sends.

```text
thermos/
  .cursor-plugin/plugin.json      # name, version, description, author
  skills/thermos/SKILL.md         # one Skill per skills/<name>/SKILL.md
  agents/reviewer.md              # one sub-agent of the plugin's Agent
  mcp.json                        # one McpServer per mcpServers entry
  ai.stigmer/agent.yaml           # optional: the Agent that replaces the composed default
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
  state: PLUGIN_STATE_READY
  materialized:
    skills: 3
    mcp_servers: 0
    agents: 1
    workflows: 0
```
