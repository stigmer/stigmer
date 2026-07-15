An AgentChannel connects an agent to an external messaging platform so
people can chat with it where they already work. The spec declares which
agent serves the channel, whether serving is enabled, the provider (Slack
today), and optional environment references that supply the agent's tool
credentials for channel conversations. Workspace identity and provider
credentials are produced by the install flow and live in status — applying
a manifest never touches them, and channel operations never modify the
referenced agent.

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
  environment_refs:
    - kind: environment
      org: workshop
      slug: support-tools-credentials
```
