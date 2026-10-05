An Environment stores configuration and secrets as key-value pairs: credentials,
API tokens, feature flags, and other values an agent declares in its `env`
without hard-coding them. Schedules, workflow `agent_call` tasks and
PlatformClients list environments in `environment_refs`, and a run reads them
when it starts; a person's personal environment fills the declared keys still
missing for the agent and workflow runs that person starts.

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
