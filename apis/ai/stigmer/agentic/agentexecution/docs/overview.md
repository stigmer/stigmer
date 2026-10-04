An AgentExecution represents a single turn in a conversation: one user message
and the agent's response, with the messages exchanged, tool calls made,
sub-agent delegations, approval decisions, and artifacts produced. A turn
continues a session (`session_id`) or starts one (`session_spec`, whose
`agent_ref` names the agent; neither starts a conversation with the built-in
assistant), runs the agent version its session records, and is refused unless
the caller may still run that agent; `status.agent_id` and
`status.agent_version_hash` record what ran.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentExecution
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
  execution_config:
    model_name: "claude-sonnet-4-6"
```
