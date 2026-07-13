An AgentShare turns an agent into a hosted chat link. It controls who can
chat with the agent at `/chat/<org>/<slug>` (anyone with the link, or org
members only), which sites may embed the chat widget, the messages visitors
see when a limit refuses them, and the environment credentials guest
conversations receive. The referenced agent is never modified by share
operations — applying an agent manifest cannot touch a share.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentShare
metadata:
  name: org-knowledge-agent
  org: workshop
spec:
  agent_ref:
    kind: agent
    org: workshop
    slug: org-knowledge-agent
  enabled: true
  audience: agent_share_audience_public
  allowed_origins:
    - "https://docs.example.com"
  messages:
    rate_limited: "You're sending messages too quickly — give it a moment."
  environment_refs:
    - kind: environment
      org: workshop
      slug: github-org-shared
```
