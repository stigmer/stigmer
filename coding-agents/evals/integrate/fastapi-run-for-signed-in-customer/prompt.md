---
tags: [integrate]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

Our backend is FastAPI. When a logged-in customer hits "Analyze my statements" in our app, I want a request to kick off our Stigmer agent for that customer and stream the agent's reply back to the page as it comes in. Show me how the request starts the run for the signed-in customer and how I stream the reply. Python, please.
