# Declarative Track

The declarative track lets you manage a group of Stigmer resources using plain YAML files — no code required. You place a `stigmer.yaml` (the project) alongside individual resource YAML files. The CLI scans the directory, applies each resource, and keeps the project's membership list synchronized.

## When to Use the Declarative Track

Use the declarative track when:

- Your resources are static — agent configs, MCP server definitions, skill definitions that you author as YAML.
- You want the simplest possible setup with no runtime dependencies.
- You are managing a small, well-bounded set of resources (a focused agent fleet, a team's MCP servers, etc.).
- You want full visibility into every resource definition as a readable file in version control.

Use the [SDK track](sdk-track.md) instead when resources need to be generated programmatically (dynamic names, conditional composition, loop-generated variants).

## Directory Layout

```
my-project/
├── stigmer.yaml              # The Project resource (no entry_point)
├── agents/
│   ├── code-reviewer.yaml    # Agent resource
│   └── deployer.yaml         # Agent resource
├── mcp-servers/
│   └── github.yaml           # McpServer resource
└── skills/
    └── style-guide.yaml      # Skill resource
```

The CLI recursively scans the directory rooted at `stigmer.yaml` for YAML files. Any file containing a valid Stigmer API resource (with `apiVersion: agentic.stigmer.ai/v1` and a supported `kind`) is discovered and applied. Subdirectories are scanned automatically — the layout above is a convention, not a requirement.

## The `stigmer.yaml` File

For the declarative track, the project file is minimal — no `entry_point`, just metadata and an optional description:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: platform-agent-fleet
  org: acme-corp
  tags:
    - platform
    - production
spec:
  description: "Production agent fleet for the platform team"
```

`spec.members` is intentionally absent. The CLI populates it at apply time.

## Apply Workflow

When you run `stigmer project apply stigmer.yaml`, the CLI:

1. **Reads** `stigmer.yaml` — determines the project metadata and detects the declarative track (no `entry_point`).
2. **Scans** the directory recursively for YAML files containing valid Stigmer resources.
3. **Applies** each discovered resource individually via its own RPC:
   - `AgentCommandController.Apply` for Agents
   - `McpServerCommandController.Apply` for McpServers
   - `SkillCommandController.Apply` for Skills
   - etc.
4. **Collects** the `ApiResourceReference` from each Apply response (org/kind/slug).
5. **Calls** `ProjectCommandController.Apply` with `spec.members` populated from the collected references.
6. **Server computes orphans**: `previous_members − current_members` → deletes orphaned resources.
7. **Prints** the reconciliation summary.

```
Applying project "platform-agent-fleet" (declarative)...
  ✓ Agent/code-reviewer (created)
  ✓ Agent/deployer (updated)
  ✓ McpServer/github (no change)
  ✓ Skill/style-guide (created)

Applied project "platform-agent-fleet":
  Members: 2 agents, 1 mcp_server, 1 skill
  Pruned:  0 resources
```

## Orphan Pruning

When a resource file is deleted from the directory, it disappears from the CLI's scan. On the next apply:

- The resource is no longer in `current_members`.
- The server subtracts: `previous_members − current_members`.
- The orphaned resource is automatically deleted from the platform.

This means **removing a resource from your project is as simple as deleting its YAML file** and re-applying.

```bash
# Remove the deployer agent
rm agents/deployer.yaml

# Re-apply — the deployer will be pruned automatically
stigmer project apply stigmer.yaml
```

```
Applying project "platform-agent-fleet" (declarative)...
  ✓ Agent/code-reviewer (no change)
  ✓ McpServer/github (no change)
  ✓ Skill/style-guide (no change)

Applied project "platform-agent-fleet":
  Members: 1 agent, 1 mcp_server, 1 skill
  Pruned:  1 agent (Agent/deployer)
```

## File Discovery Rules

The CLI applies the following rules when scanning for resource files:

| Rule | Detail |
|---|---|
| **Recursive scan** | All subdirectories under the `stigmer.yaml` directory are scanned. |
| **File extension** | Only `.yaml` and `.yml` files are considered. |
| **Valid resource required** | Files must contain `apiVersion: agentic.stigmer.ai/v1` and a supported `kind`. Non-resource YAML files (CI configs, Kubernetes manifests, etc.) are skipped. |
| **`stigmer.yaml` itself excluded** | The project file is not treated as a member resource. |
| **Order** | Resources are applied in lexicographic file-path order. Order does not affect correctness — individual Apply calls are idempotent. |

## Dry Run

Use `--dry-run` to preview what would be applied without making any changes:

```bash
stigmer project apply stigmer.yaml --dry-run
```

The dry run output shows which resources would be created, updated, or pruned without executing any Apply RPCs.

## Related Documentation

- [README.md](README.md) — Overview and full apply workflow
- [sdk-track.md](sdk-track.md) — Code-based resource synthesis with Go, Python, or Node SDKs
- [examples.md](examples.md) — Declarative project YAML examples
- [project-resource-guide.md](project-resource-guide.md) — Full spec and status schema reference
