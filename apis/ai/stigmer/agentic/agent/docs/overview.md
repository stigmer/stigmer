An Agent defines what an AI assistant knows and can do. It declares the agent's
instructions (system prompt), which MCP servers it can use, which Skills it has,
and optional Sub-Agents for delegation.

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
      enabled_tools: [search_code, create_pr]
  skill_refs:
    - kind: skill
      slug: code-review-best-practices
```
