---
tags: [stuck]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

Our backend starts a session on our `report-builder` agent for each customer (TypeScript SDK). One from this morning has been sitting "idle" for 3 hours: no report file, no error. The last thing in its events is the agent going to run a shell command to convert a csv. Is it hung? Should I just kill it and retry?
