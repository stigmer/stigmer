---
tags: [integrate]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

We're on Claude Managed Agents today. Our Node backend uses @anthropic-ai/sdk to create sessions, stream their events, and send tool confirmations. We also lean on a couple of custom tools and on outcomes for grading. Thinking about switching to Stigmer so we can self-host — how much of our code survives, and what do I have to rewrite?
