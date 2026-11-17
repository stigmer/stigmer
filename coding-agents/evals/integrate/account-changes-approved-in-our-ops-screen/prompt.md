---
tags: [integrate]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

Our IT helpdesk agent can disable user accounts and reset MFA through an MCP server we wrote. Neither should ever happen without a human saying yes, but the yes/no has to happen in our own ops dashboard (Spring Boot backend, our own UI), not in a Stigmer chat window. How do I make the agent stop and wait before those calls, and how does my Java backend find out it's waiting and send back approve or deny?
