# Validation Checklist and Common Pitfalls

Pre-apply checklist and known pitfalls when authoring Project YAML files.

## Pre-Apply Checklist

Run through this list before applying a project with `stigmer project apply stigmer.yaml`.

### Required Fields

- [ ] `apiVersion` is exactly `tenancy.stigmer.ai/v1`
- [ ] `kind` is exactly `Project`
- [ ] `metadata.name` is present
- [ ] `spec.description` is set and clearly explains what the project groups (strongly recommended)

### Organization

- [ ] `metadata.org` is set appropriately — `local` for local mode, your org slug for cloud mode
- [ ] In cloud mode, all member resources are in the same organization as the project

### Track Selection

- [ ] If using the **declarative track**: `spec.entry_point` is absent
- [ ] If using the **SDK track**: `spec.entry_point` is set to a valid file path with a recognized extension (`.go`, `.py`, `.ts`, `.js`)
- [ ] `spec.members` is **not** set in `stigmer.yaml` — this field is populated by the CLI at apply time

### Declarative Track Checks

- [ ] All resource files alongside `stigmer.yaml` contain a recognized Stigmer `apiVersion` (e.g., `agentic.stigmer.ai/v1` for Agent/Skill/McpServer)
- [ ] All resource files have a valid `kind` (`Agent`, `McpServer`, `Skill`, etc.)
- [ ] Non-Stigmer YAML files (CI configs, Kubernetes manifests) do not contain a Stigmer `apiVersion` — they will be ignored automatically, but verify none are misidentified
- [ ] Each resource file's `metadata.org` matches the project's `metadata.org`

### SDK Track Checks

- [ ] The entry-point file exists at the path specified in `spec.entry_point`
- [ ] The required SDK runtime is installed (`go`, `python`, `node`/`npx ts-node`)
- [ ] The entry point compiles and runs successfully in isolation: `go run main.go`, `python main.py`, etc.
- [ ] The entry point emits at least one resource — a project with zero members is valid but unusual; verify this is intentional

### YAML Syntax

- [ ] YAML is properly formatted and syntactically valid
- [ ] No trailing whitespace or tab characters in YAML values

## Common Pitfalls

### Writing `spec.members` manually

The `members` field is populated by the CLI as a byproduct of applying resources. Writing it manually in `stigmer.yaml` will be overwritten on the next apply and may cause confusion.

```yaml
# Wrong — never write members in stigmer.yaml
spec:
  members:
    - org: acme-corp
      kind: agent
      slug: my-agent

# Correct — let the CLI populate members
spec:
  description: "My project"
```

### Using the wrong `entry_point` extension

The CLI infers the runtime from the file extension. An unrecognized extension causes the apply to fail.

```yaml
# Wrong — .sh has no supported runtime
spec:
  entry_point: generate.sh

# Wrong — no extension
spec:
  entry_point: Makefile

# Correct
spec:
  entry_point: main.go     # Go
  # or
  entry_point: main.py     # Python
  # or
  entry_point: index.ts    # Node (TypeScript)
  # or
  entry_point: index.js    # Node (JavaScript)
```

### Missing `metadata.org` in cloud mode

In cloud mode, `metadata.org` is required. Omitting it will fail validation.

```yaml
# Wrong in cloud mode
metadata:
  name: my-project

# Correct for cloud mode
metadata:
  name: my-project
  org: acme-corp
```

In local mode, `org` defaults to `local` if omitted.

### Member resources in a different org than the project

All member resources should be in the same organization as the project. Referencing resources across orgs is not supported for member resources (cross-org references use the `org/slug` format in MCP server or skill references in agents, but project membership is same-org).

```yaml
# Wrong — project is in acme-corp but member agent is in other-org
metadata:
  org: acme-corp
# ...agent.yaml has metadata.org: other-org  ← mismatch
```

### Expecting project delete to delete member resources

Deleting a project removes only the project resource itself. Member resources are independent and continue to exist.

```bash
# This removes the project tracking resource only
stigmer project delete my-project

# Member agents, MCP servers, and skills still exist
stigmer agent list   # they are still there
```

To delete member resources, either:
1. Remove their YAML files (declarative) or stop emitting them (SDK) and re-apply the project — orphan pruning will delete them.
2. Delete them individually with `stigmer agent delete <slug>`, etc.

### SDK entry point not emitting to stdout

The CLI expects the entry point to emit synthesized resources to stdout. Ensure your SDK's `emit()` call is invoked at the end of the entry point and that nothing else is written to stdout (use stderr for logs and debugging output).

```go
// Wrong — log output on stdout will corrupt the emit stream
fmt.Println("Synthesizing resources...")   // goes to stdout
p.Emit()

// Correct — use stderr for diagnostics
fmt.Fprintln(os.Stderr, "Synthesizing resources...")
p.Emit()
```

### Non-Stigmer YAML files with `apiVersion` causing misidentification

If a non-Stigmer YAML file in the project directory contains a Stigmer `apiVersion` (e.g., `agentic.stigmer.ai/v1` or `tenancy.stigmer.ai/v1`), the CLI will attempt to apply it as a Stigmer resource. Keep non-Stigmer YAML files (Kubernetes manifests, CI configs) out of the project directory, or in a subdirectory named `.nostigmer` (excluded from scan).

### Slug mismatch after rename

If you rename a resource (`metadata.name`) and allow the slug to auto-regenerate, the old slug becomes an orphan and will be deleted on the next apply. The new slug is treated as a new resource. This is intentional, but may be surprising.

```yaml
# Before: metadata.name: Code Reviewer → slug: code-reviewer
# After:  metadata.name: PR Reviewer   → slug: pr-reviewer

# On apply:
#   ✓ Agent/pr-reviewer (created)
#   ✗ Agent/code-reviewer (deleted — orphan)
```

To rename without deleting the resource, set `metadata.slug` explicitly and keep it stable:

```yaml
metadata:
  name: PR Reviewer     # display name changes freely
  slug: code-reviewer   # slug stays stable — no orphan
```

## Related Documentation

- [README.md](README.md) — Overview and apply workflow
- [project-resource-guide.md](project-resource-guide.md) — Full spec and status schema reference
- [declarative-track.md](declarative-track.md) — Declarative track details
- [sdk-track.md](sdk-track.md) — SDK track details and runtime requirements
- [examples.md](examples.md) — Complete YAML examples
