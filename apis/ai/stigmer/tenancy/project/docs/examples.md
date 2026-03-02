# Project YAML Examples

Complete examples from minimal to multi-resource projects. All examples use valid field values and can be applied directly with `stigmer project apply stigmer.yaml`.

---

## Minimal Declarative Project

The simplest possible project — just metadata and a description. The CLI scans the directory for YAML resource files automatically.

**`stigmer.yaml`:**
```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Project
metadata:
  name: my-project
  org: local
spec:
  description: "My first Stigmer project"
```

Apply:
```bash
stigmer project apply stigmer.yaml
```

---

## Declarative Project with Multiple Resources

A project that groups agents and an MCP server into a single managed unit.

**Directory layout:**
```
platform-fleet/
├── stigmer.yaml
├── agents/
│   ├── code-reviewer.yaml
│   └── deployment-assistant.yaml
└── mcp-servers/
    └── github.yaml
```

**`stigmer.yaml`:**
```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Project
metadata:
  name: platform-fleet
  org: acme-corp
  labels:
    team: platform
  tags:
    - production
    - agent-fleet
spec:
  description: "Production agent fleet for the platform team"
```

**`agents/code-reviewer.yaml`:**
```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  org: acme-corp
spec:
  description: "Reviews pull requests for code quality and security issues"
  instructions: |
    You are a code review assistant. Review the provided code for:
    - Code quality and adherence to best practices
    - Security vulnerabilities
    - Performance issues
    - Proper error handling
  mcp_server_usages:
    - mcp_server_ref:
        org: acme-corp
        kind: mcp_server
        slug: github
      enabled_tools:
        - get_file_contents
        - list_pull_requests
        - create_pull_request_review
```

**`agents/deployment-assistant.yaml`:**
```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: deployment-assistant
  org: acme-corp
spec:
  description: "Assists with deployment operations and rollback procedures"
  instructions: |
    You are a deployment assistant. Help engineers deploy services safely,
    monitor deployments, and perform rollbacks when needed.
  mcp_server_usages:
    - mcp_server_ref:
        org: acme-corp
        kind: mcp_server
        slug: github
      enabled_tools:
        - get_file_contents
        - list_commits
```

**`mcp-servers/github.yaml`:**
```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github
  org: acme-corp
spec:
  description: "GitHub MCP server for repository operations"
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub personal access token with repo scope"
        is_secret: true
```

Apply:
```bash
cd platform-fleet
stigmer project apply stigmer.yaml
# Output:
#   ✓ McpServer/github (created)
#   ✓ Agent/code-reviewer (created)
#   ✓ Agent/deployment-assistant (created)
#   Members: 2 agents, 1 mcp_server
#   Pruned:  0 resources
```

---

## SDK Track — Go Entry Point

A project that synthesizes multiple environment-specific agents from a single Go program.

**`stigmer.yaml`:**
```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Project
metadata:
  name: multi-env-fleet
  org: acme-corp
spec:
  description: "Agents synthesized per environment via Go SDK"
  entry_point: main.go
```

**`main.go`:**
```go
package main

import (
    stigmer "github.com/stigmer/stigmer-go-sdk"
    agentv1 "github.com/stigmer/stigmer-go-sdk/agentic/agent/v1"
)

func main() {
    p := stigmer.NewProject()

    for _, env := range []string{"staging", "production"} {
        p.Add(agentv1.Agent{
            Metadata: stigmer.Metadata{
                Name: "deployer-" + env,
                Org:  "acme-corp",
                Tags: []string{env, "deployment"},
            },
            Spec: agentv1.AgentSpec{
                Description:  "Deployment agent for " + env,
                Instructions: "You are a deployment assistant for the " + env + " environment. " +
                    "Follow the " + env + " deployment runbook.",
            },
        })
    }

    p.Emit()
}
```

Apply:
```bash
stigmer project apply stigmer.yaml
# CLI runs: go run main.go
# Output:
#   ✓ Agent/deployer-staging (created)
#   ✓ Agent/deployer-production (created)
#   Members: 2 agents
#   Pruned:  0 resources
```

---

## SDK Track — Python Entry Point

```yaml
# stigmer.yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Project
metadata:
  name: python-fleet
  org: acme-corp
spec:
  description: "Agents synthesized via Python SDK"
  entry_point: main.py
```

```python
# main.py
from stigmer import Project
from stigmer.agentic.agent.v1 import Agent, AgentSpec

ENVIRONMENTS = ["dev", "staging", "production"]

p = Project()

for env in ENVIRONMENTS:
    p.add(Agent(
        name=f"monitor-{env}",
        org="acme-corp",
        spec=AgentSpec(
            description=f"Monitoring agent for {env}",
            instructions=f"You are a monitoring agent for {env}. Alert on anomalies.",
        ),
    ))

p.emit()
```

---

## Project with Labels and Tags for Discoverability

Use labels and tags to make projects easy to find and filter in the CLI and UI.

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Project
metadata:
  name: security-agents
  org: acme-corp
  labels:
    team: security
    cost-center: "engineering"
    environment: production
  annotations:
    runbook: "https://wiki.acme-corp.com/security-agents"
    oncall: "security-team@acme-corp.com"
  tags:
    - security
    - compliance
    - production
spec:
  description: "Security scanning and compliance agents for production infrastructure"
```

Filter by label in the CLI:
```bash
stigmer project list --label team=security
stigmer project list --label environment=production
```

---

## Related Documentation

- [README.md](README.md) — Overview and apply workflow
- [declarative-track.md](declarative-track.md) — Declarative track details and file discovery rules
- [sdk-track.md](sdk-track.md) — SDK track details and runtime inference
- [project-resource-guide.md](project-resource-guide.md) — Full spec and status schema reference
- [validation-checklist.md](validation-checklist.md) — Pre-apply checklist
