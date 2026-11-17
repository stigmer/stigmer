---
tags: [design]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

Our agent reads each customer's Postgres to build their monthly churn report (read-only db user, but still). Right now the connection string, password and all, is pasted straight into the agent's instructions, which I know is bad. Where is the password supposed to live so the agent can still run psql against the right database? We have about 40 customers and each one has their own db and their own password.
