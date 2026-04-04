A Project groups related resources (agents, workflows, MCP servers, skills)
under a single unit of management with automatic orphan pruning. It supports
a declarative track using YAML files and an SDK track using a code entry point.

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Project
metadata:
  name: my-agent-fleet
  org: acme-corp
spec:
  description: "Production agent fleet"
```

To use the SDK track, set an entry point:

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Project
metadata:
  name: my-super-app
  org: acme-corp
spec:
  entry_point: main.go
  description: "Go SDK project"
```
