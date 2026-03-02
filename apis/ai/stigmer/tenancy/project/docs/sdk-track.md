# SDK Track

The SDK track lets you synthesize Stigmer resource definitions using code. Instead of writing static YAML files, you write a program (in Go, Python, or Node) that constructs resource objects and emits them. The CLI executes the entry point, collects the synthesized resources, applies each, and updates the project's membership list.

## When to Use the SDK Track

Use the SDK track when:

- Resources need to be generated dynamically — conditional composition, loop-generated variants, or values computed from external sources.
- You want type-safe resource authoring with IDE completion, compile-time checks, and refactoring support.
- Your project is part of a larger software build that already uses a Go, Python, or Node codebase.
- You need to share logic across resource definitions (helper functions, shared configurations, constants).

Use the [declarative track](declarative-track.md) instead when resources are static and best expressed as readable YAML files checked into version control.

## Entry Point Configuration

Set `spec.entry_point` in `stigmer.yaml` to point at the file the CLI should execute:

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Project
metadata:
  name: my-super-app
  org: acme-corp
spec:
  description: "Go SDK project synthesizing agent resources"
  entry_point: main.go
```

The runtime is inferred from the file extension:

| Extension | Runtime | Command |
|---|---|---|
| `.go` | Go SDK | `go run <entry_point>` |
| `.py` | Python SDK | `python <entry_point>` |
| `.ts` | Node SDK | `npx ts-node <entry_point>` |
| `.js` | Node SDK | `node <entry_point>` |

The `entry_point` path is relative to the directory containing `stigmer.yaml`. The CLI executes the entry point from that directory.

## Apply Workflow

When you run `stigmer project apply stigmer.yaml`, the CLI:

1. **Reads** `stigmer.yaml` — detects the SDK track via `spec.entry_point`.
2. **Executes** the entry point using the inferred runtime.
3. **Receives** synthesized resource definitions from the entry point's output (stdout as newline-delimited JSON or YAML, or via the SDK's emit API).
4. **Applies** each resource individually via its own RPC.
5. **Collects** the `ApiResourceReference` from each Apply response.
6. **Calls** `ProjectCommandController.Apply` with the full membership list.
7. **Server computes orphans** and deletes resources no longer synthesized.
8. **Prints** the reconciliation summary.

## SDK Examples

### Go SDK

```go
// main.go
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
            },
            Spec: agentv1.AgentSpec{
                Description:  "Deployment agent for " + env,
                Instructions: "You are a deployment assistant for the " + env + " environment.",
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
```

### Python SDK

```python
# main.py
from stigmer import Project
from stigmer.agentic.agent.v1 import Agent, AgentSpec

p = Project()

for env in ["staging", "production"]:
    p.add(Agent(
        name=f"deployer-{env}",
        org="acme-corp",
        spec=AgentSpec(
            description=f"Deployment agent for {env}",
            instructions=f"You are a deployment assistant for the {env} environment.",
        ),
    ))

p.emit()
```

Apply:

```bash
stigmer project apply stigmer.yaml
# CLI runs: python main.py
```

### TypeScript SDK

```typescript
// main.ts
import { Project } from "@stigmer/sdk";
import { Agent } from "@stigmer/sdk/agentic/agent/v1";

const p = new Project();

for (const env of ["staging", "production"]) {
  p.add(new Agent({
    metadata: { name: `deployer-${env}`, org: "acme-corp" },
    spec: {
      description: `Deployment agent for ${env}`,
      instructions: `You are a deployment assistant for the ${env} environment.`,
    },
  }));
}

p.emit();
```

Apply:

```bash
stigmer project apply stigmer.yaml
# CLI runs: npx ts-node main.ts
```

## Orphan Pruning in the SDK Track

Orphan pruning works identically to the declarative track — it is driven by the membership list, not by files. If a resource was synthesized in a previous apply but the entry point no longer emits it, the server prunes it:

```python
# Before: synthesized both staging and production deployers
# After: only synthesize staging (production removed)

for env in ["staging"]:   # removed "production"
    p.add(Agent(...))
```

On the next apply, `Agent/deployer-production` is pruned automatically.

## Entry Point Execution Environment

The CLI runs the entry point from the directory containing `stigmer.yaml`. The following environment variables are available to the entry point at runtime:

| Variable | Value |
|---|---|
| `STIGMER_ORG` | The `metadata.org` from `stigmer.yaml` (for use as a default org in synthesized resources) |
| `STIGMER_PROJECT_SLUG` | The slug of the project being applied |
| `STIGMER_ENV` | `local` or `cloud`, indicating the current backend |

## Related Documentation

- [README.md](README.md) — Overview and full apply workflow
- [declarative-track.md](declarative-track.md) — YAML-file-based resource management
- [examples.md](examples.md) — Complete SDK track examples
- [project-resource-guide.md](project-resource-guide.md) — Full spec and status schema reference
