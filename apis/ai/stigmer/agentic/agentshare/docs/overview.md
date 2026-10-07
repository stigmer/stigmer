An AgentShare turns an agent into a hosted chat link. It controls who can
chat with the agent at `/chat/<share id>` (anyone with the link, or org
members only), which sites may embed the chat widget, the messages visitors
see when a limit refuses them, and the credentials guest conversations
use for what the agent needs. The link names the share only by its permanent ID, so
renaming the organization never breaks it; the share's slug names it within
its organization for the CLI and API. Each guest conversation starts on the
version `agent_ref` names, or on the agent's current version when it names none,
and the referenced agent is never modified by share operations.

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
  credentials:
    - requirement:
        declarer:
          mcp_server:
            kind: mcp_server
            org: workshop
            slug: github
        key: GITHUB_TOKEN
      credential:
        credential:
          kind: credential
          org: workshop
          slug: github-org-shared
        field: GITHUB_TOKEN
```
