---
tags: [stuck]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

`stigmer up` refuses to start: "port 7234 is already in use by pid ...". That's our own API gateway's dev container and I can't move it. How do I tell stigmer to use a different port?
