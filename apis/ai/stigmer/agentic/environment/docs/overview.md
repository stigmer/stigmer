An Environment stores configuration and secrets as key-value pairs. Agents and
workflow instances reference environments at runtime to access credentials, API
tokens, feature flags, and other values without hard-coding them.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: github-prod
  org: acme-corp
spec:
  description: "GitHub production credentials"
  data:
    GITHUB_TOKEN:
      value: "ghp_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
      description: "Personal access token with repo scope"
    LOG_LEVEL:
      value: "info"
      is_secret: false
      description: "Default log verbosity"
```
