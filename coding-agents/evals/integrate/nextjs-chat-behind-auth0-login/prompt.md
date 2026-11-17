---
tags: [integrate]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

Next.js app, users log in with Auth0. I want logged-in users to chat with our support agent right inside the dashboard, without making them sign in to anything else. What's the right way to wire Stigmer auth for this? I don't want our Stigmer key ending up in the browser.
