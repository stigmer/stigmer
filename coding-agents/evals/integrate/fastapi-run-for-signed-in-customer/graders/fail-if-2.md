---
type: llm
---

PASS unless the answer does this:

It invents SDK calls, parameters or REST endpoints the docs don't name (such as a `stream=True` flag on `send_and_wait`, `client.agents.run(...)`, a webhook callback, or an "on behalf of user" header).
