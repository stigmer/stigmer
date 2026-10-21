A Run represents a single turn in a conversation: one user message
and the agent's response. The run records the turn's phase, settings, usage,
the Files its message named and the files it changed; the messages, tool calls, approvals and
subagent threads are events in the session's log. A turn
continues a session (`session_id`) or starts one (`session_spec`, whose
`agent_ref` names the agent; neither starts a conversation with the built-in
assistant), runs the agent version its session records, and is refused unless
the caller may still run that agent; `status.agent_id` and
`status.agent_version_hash` record what ran. `run_config` asks for this
message's model and limits; unset fields fall to the agent's defaults, and
`status.run_config` records the settings the turn ran with.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Run
metadata:
  name: ask-about-deployment
  org: acme
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: deploy-assistant
  message: "What is the status of my latest deployment?"
  run_config:
    model_name: "claude-sonnet-4.6"
```
