---
tags: [own-server]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

We run the helm chart, installed back in the spring and we've kept it pinned since (I always pass `--version` with the version we installed, 0.1-something). Following your tracing docs I added the OTEL_EXPORTER_OTLP_* vars under runner.extraEnv pointing at our Langfuse and did a helm upgrade. Nothing shows up in Langfuse. Is it our config or are we just too old?
