---
tags: [design]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

The agent OCRs scanned delivery notes our customers upload, so it needs tesseract and the pdfplumber Python package in its sandbox. Also our security team says it must only be able to reach our own API (api.dockline.example) and nothing else on the internet. How do I set this up so everything is installed before the agent starts working, every time, without the agent pip-installing stuff itself mid-run?
