An Agent defines what an AI assistant knows and can do. It declares the agent's
instructions (system prompt), the plugins it uses (each whole: its skills,
agents, hooks and MCP servers), the MCP servers written in it (`mcp_servers`,
reached over HTTP, added or changed only by the organization's admins), which
Skills it has, the saved agents it may hand work to as subagents (`subagents`,
each pinned to a version when the agent is saved), and the tools it may and may
never use, in Claude Code's names (`tools` and `disallowed_tools`, deny applied
first; a plugin server's tools are `mcp__plugin_<plugin>_<server>__<tool>`, its
own server's `mcp__<server>__<tool>`). Hooks, a listed plugin's or a block
written in the agent's `hooks`, can refuse a tool call, ask a person first, or
let it run. Its `run_config` and `harness` are the run defaults a conversation
on it starts with: the model and thinking a message, routine or channel may replace,
and limits it may lower but never raise.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: quarterly-variance-reporter
  slug: variance-reporter
spec:
  description: "Turns a customer's ledger into a variance report"
  instructions: "You review a customer's quarterly ledger..."
  plugins:
    - kind: plugin
      slug: ledger
    - kind: plugin
      slug: safety
  skill_refs:
    - kind: skill
      slug: variance-report
  tools: [Read, Grep, Glob, mcp__plugin_ledger_ledger]
  disallowed_tools: [mcp__plugin_ledger_ledger__post_adjustment]
  harness: HARNESS_NATIVE
  run_config:
    model_name: claude-sonnet-4.5
    max_cost_usd: 2
```
