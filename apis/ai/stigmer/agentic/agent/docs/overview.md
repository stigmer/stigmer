An Agent defines what an AI assistant knows and can do. It declares the agent's
instructions (system prompt), the plugins it uses (each whole: its skills,
agents, hooks and MCP servers), which Skills it has, optional Sub-Agents for
delegation, and the tools it may and may never use, in Claude Code's names
(`tools` and `disallowed_tools`, deny applied first; a plugin server's tools are
`mcp__plugin_<plugin>_<server>__<tool>`). Hooks, a listed plugin's or a block
written in the agent's `hooks`, can refuse a tool call, ask a person first, or
let it run. Its `run_config` and
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
  plugins:
    - kind: plugin
      slug: github
    - kind: plugin
      slug: safety
  skill_refs:
    - kind: skill
      slug: code-review-best-practices
  tools: [Read, Grep, Glob, mcp__plugin_github_github]
  disallowed_tools: [mcp__plugin_github_github__merge_pull_request]
  harness: HARNESS_NATIVE
  run_config:
    model_name: claude-sonnet-4.5
    max_cost_usd: 2
```
