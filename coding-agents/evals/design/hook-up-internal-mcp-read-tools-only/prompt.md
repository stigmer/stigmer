---
tags: [design]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

We already run an MCP server for our internal logistics tools at https://tools.harborline.example/mcp and it wants a bearer token. How do I hook it up so our dispatch agent can use it? The agent should only get get_shipment and list_carriers, not the tools that change anything.
