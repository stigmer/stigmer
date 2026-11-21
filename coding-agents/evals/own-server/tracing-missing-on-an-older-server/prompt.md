---
tags: [own-server]
max_turns: 15
allowed_tools: [Skill, Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__plugin_stigmer_stigmer]
---

We run Stigmer on Kubernetes with the Stigmer operator, installed back in the spring and we've kept it pinned since (I always pass `--version` with the version we installed, 0.1-something, to `helm upgrade stigmer-operator`). Following your tracing docs I added the OTEL_EXPORTER_OTLP_* vars under spec.runner.extraEnv on our Stigmer resource, pointing at our Langfuse, and applied it. Nothing shows up in Langfuse. Is it our config or are we just too old?
