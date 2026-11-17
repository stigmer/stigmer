---
tags: [deciding]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

Honest question from my tech lead: why wouldn't we just drop the Claude Agent SDK (or OpenAI's agents SDK) straight into our Node backend and skip Stigmer? The agent needs to chew through a customer's uploaded spreadsheets for maybe an hour, and we really can't have one customer's files leaking into another's.
