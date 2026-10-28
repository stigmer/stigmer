# Plugins and MCP Servers

How Agents use plugins and the MCP servers inside them, carry MCP servers of
their own, narrow their tools with the two tool lists, and which MCP tools ask
for approval before they run.

## Where an MCP server comes from

MCP (Model Context Protocol) servers provide external tools to AI agents through
a standard protocol: an agent reaches GitHub, Slack, a database or an internal
service through one.

An MCP server reaches an agent two ways: in a plugin the agent lists, or written
in the agent itself under `spec.mcp_servers` (see
[An Agent's own MCP servers](#an-agents-own-mcp-servers)). Neither is a resource
of its own.

A plugin (`kind: plugin`, enum value 58) is an installed Agent Plugins package: its MCP configuration names its
servers, beside its skills, agents and hooks. Installing it stores the plugin
alone, and its `status` lists what the archive holds (`skills`, `agents`,
`mcp_servers`, `env`, `hooks`). See the Plugin resource's `overview.md`.

To share one server at an address with every agent and chat, install it as a
plugin of its own:

```bash
stigmer mcp add linear https://mcp.linear.app/mcp
```

## How Agents Use Plugins

An agent lists the plugins it uses in `spec.plugins`. Each plugin is attached
whole: its skills (named `<plugin>:<skill>` in a turn), its agents (subagents
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

## An Agent's own MCP servers

`spec.mcp_servers` lists MCP servers written in the agent itself, beside its
plugins' servers, as Claude Managed Agents' `mcp_servers` and a Claude Code
subagent's `mcpServers` do. Each entry is an `AgentMcpServer`: a `name`, a
`url` and optional `headers`.

```yaml
spec:
  mcp_servers:
    - name: ledger
      url: https://ledger.acme-books.example/mcp
      headers:
        Authorization: Bearer ${LEDGER_API_KEY}
  tools: [Read, mcp__ledger]
```

- **Who writes them.** Only the organization's admins (`can_create_plugin` on
  the organization) may add a server or change one's address or headers;
  anyone who may edit the agent may keep or remove them. The check runs on
  every write of `spec`, by content.
- **What they are.** HTTP only: an `https` address, or `http` on a loopback
  host, with no credentials or fragment. At most 20. They are on agents only:
  a Session has no `mcp_servers`, and a local program (stdio) comes in a
  plugin.
- **Names.** 2 to 63 lowercase letters, digits and hyphens, starting with a
  letter and not ending with a hyphen. The save refuses a name used twice, any
  name starting with `stigmer` (the platform's own servers), and `plugin`.
- **Headers.** A value may name a run value as `${NAME}`. A `${NAME}` the
  agent's `env` does not declare is a required secret, except the platform's
  own variables. Each value is sent to that server only, never to the agent's
  shell. Header values are stored in the agent and returned to anyone who can
  read it, so a secret goes in a vault and the header names it. The save
  refuses a header named twice in any letter case and a `${...}` that is not a
  variable name.
- **The login.** With no `Authorization` header, a run uses the vault
  connection saved at the server's address, else a vault secret named
  `<NAME>_ACCESS_TOKEN` (the name upper-cased, each other character written as
  `_`), else it calls the server with no login. An `Authorization` header that
  names `${NAME}` takes the login from that key, and the run then needs it.
  The server is not probed at save; the agent's page offers **Sign in** for a
  server that asks for one.
- **One name per turn.** An agent and a subagent it lists may not both have a
  server of the same name: run planning refuses the turn, naming both homes.
- **Versions.** A conversation runs the agent version it started on, so a
  changed address or header reaches the conversations started after it.
- **Listing.** `PluginCommandController.listTools` and `stigmer connect` list a
  plugin's servers only; an agent's own server cannot be listed yet
  ([#2325](https://github.com/stigmer/stigmer/issues/2325)).

## Tool Names

A server's tools are named as Claude Code names them. For a plugin's server:

- `mcp__plugin_<plugin>_<server>` for every tool of one server
- `mcp__plugin_<plugin>_<server>__<tool>` for one tool

For a server in the agent's own `mcp_servers`:

- `mcp__<server>` for every tool of the server
- `mcp__<server>__<tool>` for one tool

`<plugin>` is the plugin's slug and `<server>` the server's key in the plugin's
MCP configuration (`status.mcp_servers[].name`). Every character outside
letters, digits, `_` and `-` is written as `_`. Install refuses a plugin whose
name or server name would hold `__` or end with `_`, since the tool name could
not be read back.

## Narrowing Tools: `tools` and `disallowed_tools`

An agent and each agent file in a plugin can carry Claude Code's two lists, in
Claude Code's names:

- `tools`: only these. Empty means every tool the agent has.
- `disallowed_tools`: never these.

`disallowed_tools` is applied first, then `tools` against what remains, so a
tool named in both is excluded.

| Entry                                                       | Means                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Read`, `Grep`, `Glob`, `Write`, `Edit`, `Bash`, `WebFetch` | One built-in tool.                                                                                                          |
| `Bash(git push *)`                                          | A specifier in parentheses is accepted and governs the whole tool.                                                          |
| `Agent(explore)`                                            | In the main agent's `tools`, limits which subagents it may start.                                                           |
| `mcp__plugin_<plugin>_<server>`                             | Every tool of one plugin's MCP server.                                                                                      |
| `mcp__plugin_<plugin>_<server>__<tool>`                     | One tool of that server, by the name the server reports in `tools/list`.                                                    |
| `mcp__<server>`                                             | Every tool of one of the agent's own MCP servers (`spec.mcp_servers`).                                                      |
| `mcp__<server>__<tool>`                                     | One tool of that server.                                                                                                    |
| `mcp__*`                                                    | Every MCP tool.                                                                                                             |

Rules that follow from the lists:

- They hold on every engine, and when a run is set to approve everything.
- A plugin subagent starts from the main agent's tools and can narrow them,
  never widen them. A saved subagent has its own lists instead, capped by the
  turn's and not by the main agent's. See [subagents.md](subagents.md).
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
in your own vault (a plugin's server only; see
[An Agent's own MCP servers](#an-agents-own-mcp-servers) for the agent's own):

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

1. **Agent** lists `plugins` (references only: no connections, no secrets) and
   its own `mcp_servers` (addresses and headers, with secrets named as
   `${NAME}`).
2. **The run** resolves each plugin at turn start, at the reference's version or
   the installed one, adds the conversation's own plugins, and adds the agent's
   own servers at the agent version the conversation runs.
3. **The run** resolves the variables each server reads (`status.env`) from
   vaults: a server's login by a sign-in at the server's address, other keys by
   secret name. The sender's My vault comes first when the conversation includes
   it, then the vaults the conversation lists; a run no person sent uses only
   the vaults its conversation and its routine, share, channel or platform
   client name. A header may name a variable as `${NAME}`. The platform fills
   four optional variables itself: `STIGMER_CALLER_IDENTITY_KIND`,
   `STIGMER_CALLER_IDENTITY_VALUE`, `STIGMER_SESSION_ID` and
   `STIGMER_SERVER_ADDRESS`.
4. **Agent Runner** starts each local program (stdio) or calls each address
   (HTTP, which every agent's own server is) with those values, and the servers' tools become available to the
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
Different routines can attach different vaults to the same Agent (e.g., staging
vs production credentials).
