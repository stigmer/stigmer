---
tags: [admin]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

We're on Stigmer Cloud. Our product's users already log in with our own Auth0. Our customers are accounting firms, each with a few users, and each firm has its own QuickBooks API key the agent needs. How should sign-in work so their people don't need a Stigmer login, and where do the firm keys live so firm A can never end up using firm B's key?
