---
tags: [own-server]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

we self-host with docker compose on a small VM. the agents run python/pandas on big ledgers and it's choking the box. can I run the runner on a separate beefier machine and point it at the server? or run several runners? what's the supported way to get the agent work off this VM
