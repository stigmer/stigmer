An Agent defines what an AI assistant knows and can do. It declares the agent's
instructions (system prompt), which MCP servers it can use, which Skills it has,
optional Sub-Agents for delegation, and the tools it may and may never use, in
Claude Code's names (`tools` and `disallowed_tools`, deny applied first). Its
`hooks`, a plugin's or a block written in the agent in Claude Code's format, can
refuse a tool call, ask a person first, or let it run. Its `run_config` and
`harness` are the run defaults a conversation on it starts with: the model and
thinking a message or a surface may replace, and limits it may lower but never
raise.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: engineering-assistant
  slug: eng-assistant
spec:
  description: "Helps engineering teams with code review"
  instructions: "You are an engineering assistant..."
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
  skill_refs:
    - kind: skill
      slug: code-review-best-practices
  tools: [Read, Grep, Glob, mcp__github]
  disallowed_tools: [mcp__github__merge_pull_request]
  hooks:
    - plugin:
        kind: plugin
        slug: safety
  harness: HARNESS_NATIVE
  run_config:
    model_name: claude-sonnet-4.5
    max_cost_usd: 2
```
