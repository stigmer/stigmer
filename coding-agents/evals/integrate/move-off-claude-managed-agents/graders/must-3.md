---
type: llm
---

PASS if the answer makes this point, in substance (in its own words):

Says custom tools carry over: they are declared on the Session when it is created through Stigmer's API (not through `agent_with_overrides`), and the `agent.custom_tool_use` and `user.custom_tool_result` events keep their shape, so the code that answers them stays.
