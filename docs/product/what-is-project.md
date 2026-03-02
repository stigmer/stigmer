# What is a Project?

## One-Sentence Positioning

**A Project is a versioned, managed grouping of Stigmer resources—the same way a Helm chart is a versioned, managed grouping of Kubernetes resources.**

---

## Executive Summary

A Project is a Stigmer API resource that groups related agents, MCP servers, skills, and workflows under a single unit of management. When you apply a project, the CLI applies every resource it contains—and automatically deletes resources that were removed since the last apply. One command. One source of truth. No orphans.

Projects support two authoring tracks. The **declarative track** is the simplest: place YAML resource files in a directory alongside a `stigmer.yaml` project file. The CLI scans the directory, applies each resource, and keeps the membership list synchronized. The **SDK track** goes further: point the project at a Go, Python, or TypeScript entry point and the CLI executes it to synthesize resource definitions in code—enabling dynamic composition, loops, conditions, and shared logic that static YAML cannot express.

In both tracks, the project stores only *references* to its members (an `org/kind/slug` triple for each resource), never full copies. The resources are independent, first-class platform objects. The project is the manager, not the container.

---

## The Problem Projects Solve

### AI Resource Sets Are Applied Piecemeal

When a team builds an agent system—say, a code review fleet with three agents, a GitHub MCP server, and a shared style-guide skill—they apply each resource individually:

```bash
stigmer agent apply code-reviewer.yaml
stigmer agent apply security-scanner.yaml
stigmer agent apply pr-summarizer.yaml
stigmer mcp-server apply github.yaml
stigmer skill apply style-guide.yaml
```

This works initially. It breaks down as the system evolves.

**What goes wrong:**

- A teammate deletes `security-scanner.yaml` from the repo. The agent still exists on the server—nobody deletes it because nobody knows it's orphaned.
- Onboarding a new team member means handing them five commands in the right order. There is no single "apply the whole thing" operation.
- Tearing down a demo environment means remembering every resource that was created. Miss one, and it lingers.
- Resources drift: the YAML on disk diverges from what is actually running because partial applies happened over weeks of ad-hoc changes.
- There is no clear answer to "what resources make up our code review system?"—the mapping lives in someone's head or a stale wiki page.

### The Hidden Cost

This scales badly with system complexity:

- **No ownership boundary**: There is no artifact that says "these five resources form one logical system."
- **No automatic cleanup**: Removed resources are never deleted unless someone remembers to delete them manually.
- **No single apply**: Bootstrapping a fresh environment requires knowing the full resource list and the right apply order.
- **No drift detection**: There is no way to tell whether the running resources match the definitions in version control.
- **No programmatic composition**: Static YAML cannot express "create an agent per environment" or "conditionally include this MCP server based on a flag." Every variant must be maintained as a separate file.

---

## The Stigmer Project

### One Command. Full System.

```bash
# Apply the entire code review fleet — every resource, in one command
stigmer project apply stigmer.yaml

# Same command in production, staging, or a teammate's machine
stigmer project apply stigmer.yaml
```

The CLI handles discovery, ordering, apply, and cleanup. You author resources. The project keeps them synchronized.

### What the YAML Looks Like

**The project file (`stigmer.yaml`):**

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Project
metadata:
  name: code-review-fleet
  org: acme-corp
  tags:
    - platform
    - code-review
spec:
  description: "Code review agents and shared infrastructure for the platform team"
```

That is all users write. The CLI populates `spec.members` automatically — you never touch it.

**Alongside it, the resource files:**

```
code-review-fleet/
├── stigmer.yaml                  ← the project
├── agents/
│   ├── code-reviewer.yaml
│   ├── security-scanner.yaml
│   └── pr-summarizer.yaml
├── mcp-servers/
│   └── github.yaml
└── skills/
    └── style-guide.yaml
```

Apply it once:

```bash
cd code-review-fleet
stigmer project apply stigmer.yaml
```

```
Applying project "code-review-fleet" (declarative)...
  ✓ McpServer/github (created)
  ✓ Skill/style-guide (created)
  ✓ Agent/code-reviewer (created)
  ✓ Agent/security-scanner (created)
  ✓ Agent/pr-summarizer (created)

Applied project "code-review-fleet":
  Members: 3 agents, 1 mcp_server, 1 skill
  Pruned:  0 resources
```

Remove `security-scanner.yaml` and re-apply:

```
Applying project "code-review-fleet" (declarative)...
  ✓ McpServer/github (no change)
  ✓ Skill/style-guide (no change)
  ✓ Agent/code-reviewer (no change)
  ✓ Agent/pr-summarizer (no change)

Applied project "code-review-fleet":
  Members: 2 agents, 1 mcp_server, 1 skill
  Pruned:  1 agent (Agent/security-scanner)    ← automatically deleted
```

The server computes the difference between the previous membership list and the current one. Resources that disappear are deleted. No manual cleanup required.

---

## The Two Tracks

### Declarative Track — YAML Files

Place resource YAML files alongside `stigmer.yaml`. The CLI scans the directory recursively, discovers every file containing a valid Stigmer resource, applies each one, and synchronizes the project's membership list.

**When to use it:** Resources are static. You want full visibility into every definition as a readable file in version control. No code needed.

```
my-project/
├── stigmer.yaml      ← no entry_point
├── agent-a.yaml
├── agent-b.yaml
└── mcp-server.yaml
```

### SDK Track — Code Synthesis

Point the project at an entry-point file. The CLI executes it (inferring the runtime from the file extension), collects the synthesized resource definitions, applies each, and synchronizes membership.

**When to use it:** Resources need to be generated programmatically—loop over environments, conditionally include a resource, share constants across definitions, or compute values from external sources.

```yaml
# stigmer.yaml — SDK track
spec:
  entry_point: main.go    # .go → go run, .py → python, .ts → npx ts-node, .js → node
```

```go
// main.go — generates an agent per environment
for _, env := range []string{"staging", "production"} {
    p.Add(agentv1.Agent{
        Metadata: stigmer.Metadata{Name: "deployer-" + env, Org: "acme-corp"},
        Spec:     agentv1.AgentSpec{Instructions: "Deploy to " + env},
    })
}
p.Emit()
```

The same orphan pruning applies: if the entry point stops emitting a resource, it is deleted on the next apply.

---

## Orphan Pruning

Orphan pruning is the mechanism that keeps running resources synchronized with the project definition. The server maintains the membership list from the previous apply. On every new apply, it computes:

```
orphans = previous_members − current_members
```

Resources in `orphans` are automatically deleted.

This means:

- **Declarative track**: deleting a YAML file removes the resource from the platform on the next apply.
- **SDK track**: removing a resource from the entry point's output removes it from the platform on the next apply.

No manual delete commands. No drifted state. The project definition is always the source of truth.

> **Note:** Deleting the project resource itself does *not* delete member resources. Orphan pruning only runs during `stigmer project apply`. To clean up member resources, remove them from the project and re-apply, which triggers pruning.

---

## How Projects Fit the Platform

Projects are designed to compose with the rest of the Stigmer resource model, not to replace it. Resources remain independent — an agent referenced by a project can also be referenced directly, shared across projects, or published to the marketplace.

```
Project (stigmer.yaml)
  ├── declares members: agents, mcp_servers, skills, workflows
  ├── applies each via their own RPCs (AgentCommandController.Apply, etc.)
  ├── stores only references (org/kind/slug) — never full resource copies
  └── prunes orphans on every apply (previous_members − current_members)

Resources (independent, first-class objects)
  ├── Agent — has its own versioning, visibility, marketplace listing
  ├── McpServer — reusable across many agents, many projects
  ├── Skill — reusable across many agents, many projects
  └── Workflow — orchestrates multi-step processes
```

A project is a *manager*, not a *container*. It groups resources for lifecycle purposes but does not own them exclusively. The same GitHub MCP server can be a member of both the code review project and the deployment project.

---

## How It Compares

| Without Projects | With Projects |
|---|---|
| Apply each resource manually in the right order | Single `stigmer project apply` applies the full system |
| Removed resources linger until manually deleted | Orphan pruning deletes removed resources automatically |
| No artifact defines what resources belong together | `stigmer.yaml` is the authoritative ownership boundary |
| Bootstrapping a fresh environment requires a runbook | `stigmer project apply` — same command, same result |
| Static YAML cannot express "one agent per environment" | SDK track: loop, conditionals, and shared logic in Go, Python, or Node |
| Drift between version control and running resources | Every apply synchronizes the membership list |

---

## Getting Started

### Declarative Project (no code required)

```bash
# 1. Create a project directory
mkdir my-fleet && cd my-fleet

# 2. Write the project file
cat > stigmer.yaml << 'EOF'
apiVersion: tenancy.stigmer.ai/v1
kind: Project
metadata:
  name: my-fleet
  org: local
spec:
  description: "My first Stigmer project"
EOF

# 3. Add a resource file
cat > agent.yaml << 'EOF'
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: assistant
  org: local
spec:
  description: "A helpful assistant"
  instructions: |
    You are a helpful assistant. Answer questions clearly and concisely.
EOF

# 4. Apply the project
stigmer project apply stigmer.yaml

# 5. List projects
stigmer project list

# 6. See the full project (with member list)
stigmer project get my-fleet --output yaml
```

### SDK Project (Go)

```bash
# 1. Create a project directory
mkdir my-sdk-fleet && cd my-sdk-fleet

# 2. Write the project file
cat > stigmer.yaml << 'EOF'
apiVersion: tenancy.stigmer.ai/v1
kind: Project
metadata:
  name: my-sdk-fleet
  org: local
spec:
  description: "Synthesized via Go SDK"
  entry_point: main.go
EOF

# 3. Write the entry point (generates resources in code)
# ... see sdk-track.md for full examples

# 4. Apply — CLI runs: go run main.go
stigmer project apply stigmer.yaml
```

---

## Further Reading

- [Project YAML Schema Reference](../../apis/ai/stigmer/tenancy/project/docs/project-resource-guide.md) — Complete field documentation, spec, status, and CLI commands
- [Declarative Track](../../apis/ai/stigmer/tenancy/project/docs/declarative-track.md) — Directory layout, file discovery, orphan pruning
- [SDK Track](../../apis/ai/stigmer/tenancy/project/docs/sdk-track.md) — Entry-point execution, runtime inference, Go/Python/Node examples
- [Examples](../../apis/ai/stigmer/tenancy/project/docs/examples.md) — Complete YAML and SDK examples
- [What is an Agent?](what-is-agent.md) — The core resource that projects most commonly manage
- [What is an Agent Execution?](what-is-agent-execution.md) — How agents run once they are applied
