An AgentInstance binds an Agent template to one or more Environment resources,
supplying the secrets and configuration the agent needs at runtime. Create
separate instances for different environments (staging, production) or teams
without duplicating the agent definition.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: github-bot-prod
  org: acme-corp
spec:
  agent_id: agt_abc123
  description: "GitHub bot with production credentials"
  environment_refs:
    - kind: environment
      slug: base-config
    - kind: environment
      slug: github-prod-secrets
```
