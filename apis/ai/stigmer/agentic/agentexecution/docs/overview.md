An AgentExecution represents a single turn in a conversation: one user message
and the agent's response. It captures everything that happened during that turn
-- the messages exchanged, tool calls made, sub-agent delegations, approval
decisions, and artifacts produced.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentExecution
metadata:
  name: ask-about-deployment
spec:
  session_id: "ses_01HGXXX..."
  agent_id: "agt_01HGYYY..."
  message: "What is the status of my latest deployment?"
  execution_config:
    model_name: "claude-sonnet-4-6"
```

Instead of `session_id`, a create may carry `session_spec` — the full shape of a
session to auto-create (workspace entries, harness, execution target). This is
the one-call bootstrap: the server creates the session and dispatches the first
message in a single request, and the created session's ID is returned on the
execution's `session_id`.
