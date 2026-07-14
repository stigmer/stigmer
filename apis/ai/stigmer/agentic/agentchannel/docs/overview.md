An AgentChannel connects an agent to an external messaging platform so
people can chat with it where they already work. The spec declares which
agent serves the channel, whether serving is enabled, and the provider
(Slack today). Workspace identity and credential references are produced
by the install flow and live in status — applying a manifest never
touches them, and channel operations never modify the referenced agent.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentChannel
metadata:
  name: support-agent-slack
  org: workshop
spec:
  agent_ref:
    kind: agent
    org: workshop
    slug: support-agent
  enabled: true
  slack: {}
```
