# MCP Server Integration

How Agents declare and use MCP servers, narrow them with the two tool lists, and
which MCP tools ask for approval before they run.

## What Are MCP Servers?

MCP (Model Context Protocol) servers provide external tools and capabilities to
AI agents through a standardized protocol. They enable agents to interact with
external systems (GitHub, Slack, databases), access local resources, and execute
custom operations.

MCP servers are first-class platform resources (`kind: mcp_server`, enum value
44). They are created and managed independently, then referenced by agents. See
[resource-references.md](resource-references.md) for the reference format.

## How Agents Reference MCP Servers

Agents declare MCP server usage via `spec.mcp_server_usages`. Each entry
references one McpServer resource. Every tool of a used server is available to
the agent unless the agent's tool lists say otherwise.

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
  tools: [Read, Grep, mcp__github]
  disallowed_tools: [mcp__github__delete_repository]
```

## McpServerUsage Fields

Defined by `McpServerUsage` in `ai/stigmer/agentic/mcpserver/v1/usage.proto` (package `ai.stigmer.agentic.mcpserver.v1`), shared by agents and sessions. Earlier releases declared it in the `ai.stigmer.agentic.agent.v1` package; the move changed SDK import paths only, never the wire or JSON form.

| Field            | Required | Description                                                                                                            |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `mcp_server_ref` | Yes      | Reference to a McpServer resource. Must have `kind: mcp_server`. See [resource-references.md](resource-references.md). |

The `mcp_server_ref.slug` from each entry must be **unique** within a single
agent's `mcp_server_usages`. You cannot reference the same MCP server twice.

The slug is also how the tool lists name the server's tools:
`mcp__<server-slug>` for all of them, `mcp__<server-slug>__<tool>` for one.

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
| `mcp__<server-slug>`                                        | Every tool of one MCP server.                                                                                               |
| `mcp__<server-slug>__<tool>`                                | One tool of one MCP server, by the name the server reports in `tools/list`.                                                 |
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
- Servers attached to a session are governed by the agent's lists like its own
  servers.

Find a server's tool names by querying it:

```bash
stigmer get mcp-server github --output yaml
```

Only names under `discovered_capabilities.tools` are tools. Resource templates
are read-only data endpoints, and a tool list never names them.

## Which MCP Tools Ask for Approval

Stigmer asks before shell commands, file writes and deletes, and any MCP tool
whose server marks it destructive (`destructiveHint: true` in the tool's MCP
annotations, recorded at connect as
`discovered_capabilities.tools[].destructive_hint`). By default nothing else
asks. The approval card reads `Execute <tool>`.

The server carries no approval setting of its own. An agent's `hooks` decide
call by call: a hook can refuse any tool, ask about it, or let it run without
the approval it would otherwise need (see [Hooks](agent-resource-guide.md#hooks)).
To keep an agent away from a tool, leave it out with the tool lists.

`Run.auto_approve_all` bypasses approval for one run. It is set
at run time (not in the Agent YAML) and is typically used for trusted
automation where human-in-the-loop approval is not needed. It never widens the
tool lists.

## Runtime Resolution Flow

At runtime, the Agent does not connect to MCP servers directly. The flow is:

1. **Agent** declares `mcp_server_usages` (references only — no connections, no
   secrets)
2. **The run** resolves the declared keys when it starts, from vaults: a
   tool's login by a connection at the tool's address, other keys by secret
   name. The conversation's own values come first, then its vaults, then the
   sender's My vault and the agent's vaults they may use; a run no person sent
   uses only the vaults its schedule, share, channel or platform client names
3. **Agent Runner** resolves each McpServer reference, passes each server the
   keys it declares, and starts the actual MCP server process
4. The running MCP server's tools become available to the agent during the
   Run

This separation means the Agent YAML is portable and contains no secrets.
Different schedules can attach different vaults to the same Agent (e.g.,
staging vs production credentials).
