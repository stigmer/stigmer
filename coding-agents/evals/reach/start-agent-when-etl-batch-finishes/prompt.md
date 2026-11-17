---
tags: [reach]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

Our nightly ETL in Airflow finishes whenever it finishes (anywhere from 1am to 5am). When it's done I want it to kick off our reconciliation agent and tell it which batch id just landed. Is there a webhook or something Airflow can hit? I don't want this tied to my personal login.
