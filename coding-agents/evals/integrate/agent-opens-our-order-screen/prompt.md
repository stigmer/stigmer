---
tags: [integrate]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

In our React app (we use `AgentChat` from `@stigmer/react-sdk`), we want the agent to be able to open our own order form, prefilled with what it worked out, wait while the person checks and edits it, and then carry on with whatever they submitted, or know that they cancelled. Is that possible with Stigmer, and how would we build it?
