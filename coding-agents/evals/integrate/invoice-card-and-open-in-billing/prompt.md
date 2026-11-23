---
tags: [integrate]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

Our agent uses our billing MCP server, which we connected to it as `billing`. When its `create_invoice` tool runs, the Stigmer chat in our React app (`AgentChat` from `@stigmer/react-sdk`) shows a generic tool row. Our product team wants our own invoice card there instead, the one we already use elsewhere in the app, and an "Open in Billing" button on the agent's final answer that takes the user to the invoice. How do we do that?
