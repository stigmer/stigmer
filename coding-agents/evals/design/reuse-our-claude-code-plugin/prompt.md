---
tags: [design]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

my team already has a Claude Code plugin in a repo: two skills for how we write customer-facing incident summaries, and a hooks.json with a PreToolUse hook that blocks file writes outside /reports. Do I have to rewrite any of that for Stigmer, or can our incident agent just use it as is?
