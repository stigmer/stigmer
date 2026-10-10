# Plugin Integration

How Agents use plugins and the MCP servers inside them, narrow their tools with
the two tool lists, and which MCP tools ask for approval before they run.

## Plugins and MCP Servers

MCP (Model Context Protocol) servers provide external tools to AI agents through
a standard protocol: an agent reaches GitHub, Slack, a database or an internal
service through one.

An MCP server exists only inside a plugin. A plugin (`kind: plugin`, enum value
58) is an installed Agent Plugins package: its MCP configuration names its
servers, beside its skills, agents and hooks. Installing it stores the plugin
alone, and its `status` lists what the archive holds (`skills`, `agents`,
`mcp_servers`, `env`, `hooks`). See the Plugin resource's `overview.md`.

To use one server at an address, install it as a plugin of its own:

```bash
stigmer mcp add linear https://mcp.linear.app/mcp
```

## How Agents Use Plugins

An agent lists the plugins it uses in `spec.plugins`. Each plugin is attached
whole: its skills (named `<plugin>:<skill>` in a turn), its agents (sub-agents
named `<plugin>:<agent>`), its hooks and its MCP servers. Every tool of an
attached server is available to the agent unless the agent's tool lists say
otherwise.

```yaml
spec:
  plugins:
    - kind: plugin
      slug: github
  tools: [Read, Grep, mcp__plugin_github_github]
  disallowed_tools: [mcp__plugin_github_github__delete_repository]
```

Each entry is an `ApiResourceReference` with `kind: plugin` (see
[resource-references.md](resource-references.md)); a plugin is listed once. A
reference with no `version` follows the plugin's installed version.

A conversation can list plugins of its own in the Session's `spec.plugins`; they
are added to the agent's, one entry per plugin, and the agent's tool lists
govern them like its own. A chat with the built-in assistant (no agent) gets its
tools from the plugins its conversation lists.

## Tool Names

A plugin server's tools are named as Claude Code names them:

- `mcp__plugin_<plugin>_<server>` for every tool of one server
- `mcp__plugin_<plugin>_<server>__<tool>` for one tool

`<plugin>` is the plugin's slug and `<server>` the server's key in the plugin's
MCP configuration (`status.mcp_servers[].name`). Every character outside
letters, digits, `_` and `-` is written as `_`. Install refuses a plugin whose
name or server name would hold `__` or end with `_`, since the tool name could
not be read back.

## Narrowing Tools: `tools` and `disallowed_tools`

An agent and each of its sub-agents can carry Claude Code's two lists, in Claude
Code's names:

- `tools`: only these. Empty means every tool the agent has.
- `disallowed_tools`: never these.

`disallowed_tools` is applied first, then `tools` against what remains, so a
tool named in both is excluded.

| Entry                                                       | Means                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Read`, `Grep`, `Glob`, `Write`, `Edit`, `Bash`, `WebFetch` | One built-in tool.                                                                                                          |
| `Bash(git push *)`                                          | A specifier in parentheses is accepted and governs the whole tool.                                                          |
| `Agent(explore)`                                            | In the main agent's `tools`, limits which sub-agents it may start (native harness; the Cursor harness refuses such a turn). |
| `mcp__plugin_<plugin>_<server>`                             | Every tool of one plugin's MCP server.                                                                                      |
| `mcp__plugin_<plugin>_<server>__<tool>`                     | One tool of that server, by the name the server reports in `tools/list`.                                                    |
| `mcp__*`                                                    | Every MCP tool.                                                                                                             |

Rules that follow from the lists:

- They hold on both engines, and when a run is set to approve everything.
- A sub-agent starts from the parent's tools and can narrow them, never widen
  them. See [sub-agents.md](sub-agents.md).
- With `Read` excluded, the agent still reads its own skills, inputs and plan.
- The platform's own tools (channel messaging, conversation participation and
  memory) are outside the lists.
- The shape of each entry is checked at apply. Names are resolved at run time:
  an entry that names no tool the run has is ignored, and a `tools` list in
  which no entry resolves refuses the run, naming the entries.
- A conversation's own plugins are governed by the agent's lists: an agent
  whose `tools` list does not name a plugin's server cannot use it.

Find a server's tool names by asking it. Nothing about a server's tools is
stored; each listing reaches the live server as you, with the keys and sign-ins
in your own vault:

```bash
stigmer connect plugin github
stigmer connect plugin acme-tools --server issues
```

The console's plugin page does the same with **Check tools**, and both call
`PluginCommandController.listTools`. Only tools are listed: resource templates
are read-only data endpoints, and a tool list never names them.

## Which MCP Tools Ask for Approval

Stigmer asks before shell commands, file writes and deletes, and any MCP tool
whose server marks it destructive (`destructiveHint: true` in the tool's MCP
annotations). The annotation is read from the live server at the start of each
turn, so a server that changes it changes what asks. A server whose tools cannot
be listed when the turn starts asks before every one of its tools. By default
nothing else asks. The approval card reads `Execute <tool>`.

The server carries no approval setting of its own. Hooks decide call by call,
the plugins' hooks and the agent's own: a hook can refuse any tool, ask about
it, or let it run without the approval it would otherwise need (see
[Hooks](agent-resource-guide.md#hooks)). To keep an agent away from a tool,
leave it out with the tool lists.

`Run.auto_approve_all` bypasses approval for one run. It is set at run time (not
in the Agent YAML) and is typically used for trusted automation where
human-in-the-loop approval is not needed. It never widens the tool lists.

## Runtime Resolution Flow

At runtime, the Agent does not connect to MCP servers directly. The flow is:

1. **Agent** lists `plugins` (references only: no connections, no secrets).
2. **The run** resolves each plugin at turn start, at the reference's version or
   the installed one, and adds the conversation's own plugins.
3. **The run** resolves the variables each server reads (`status.env`) from
   vaults: a server's login by a sign-in at the server's address, other keys by
   secret name. The sender's My vault comes first when the conversation includes
   it, then the vaults the conversation lists; a run no person sent uses only
   the vaults its conversation and its schedule, share, channel or platform
   client name. A header may name a variable as `${NAME}`. The platform fills
   four optional variables itself: `STIGMER_CALLER_IDENTITY_KIND`,
   `STIGMER_CALLER_IDENTITY_VALUE`, `STIGMER_SESSION_ID` and
   `STIGMER_SERVER_ADDRESS`.
4. **Agent Runner** starts each local program (stdio) or calls each address
   (HTTP) with those values, and the servers' tools become available to the
   agent during the run.

A local program runs only where the person's own runner runs (the desktop app,
the CLI). A conversation hosted in a cloud sandbox whose runner runs in cloud
mode is refused at create when one of its plugins carries a local program.

A server at an address with no key in its headers is probed at install. When it
answers with an OAuth challenge, its entry records `sign_in.oauth_only`, a login
key named `<SERVER>_ACCESS_TOKEN` and an `Authorization: Bearer ${…}` header
naming it: a person signs in once, from the plugin's page or with
`stigmer connect plugin`, and the login is kept in their vault.

This separation means the Agent YAML is portable and contains no secrets.
Different schedules can attach different vaults to the same Agent (e.g., staging
vs production credentials).
