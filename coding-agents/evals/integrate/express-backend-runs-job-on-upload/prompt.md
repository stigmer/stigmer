---
tags: [integrate]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

we run an express api. when a customer uploads their monthly expenses csv I want the backend to hand it to our "expense-auditor" agent, wait for it to finish, and save whatever report file it produces so we can email it to them. what does that code look like with stigmer? we're on stigmer cloud
