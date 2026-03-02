# Project Resource Documentation

Comprehensive documentation for the `tenancy.stigmer.ai/v1` Project resource.

## What Is a Project?

A Project is a Kubernetes-style API resource that **groups related Stigmer resources under a single unit of management**. It tracks which agents, MCP servers, skills, and workflows belong together and automatically deletes resources that are removed from the project (orphan pruning).

Projects support two authoring tracks:

- **Declarative Track** — place YAML resource files alongside `stigmer.yaml`. The CLI scans the directory, applies each resource individually, and updates project membership. No code required.
- **SDK Track** — point the project at an entry-point file (`.go`, `.py`, `.ts`, `.js`). The CLI executes it to synthesize resource definitions in code, applies each, and updates membership.

In both tracks, the project stores only **references** to its members — never full resource objects. The resources themselves are independent first-class platform resources.

## Project in the Platform Lifecycle

```
Project (stigmer.yaml)
  ├── Declarative Track: scan *.yaml files → apply each → update members
  └── SDK Track: run entry_point → synthesize resources → apply each → update members
                             ↓
                    Members: org/kind/slug references
                             ↓
              Orphan Pruning: previous_members − current_members → delete
```

| Concept | Role |
|---|---|
| **Project** | Groups resources under a single unit of management. Stores membership references and drives orphan pruning. |
| **Members** | `ApiResourceReference` values (org/kind/slug) pointing to applied resources. Derived automatically by the CLI — never written by users. |
| **Orphan Pruning** | Resources that appeared in the previous members list but are absent from the current list are deleted automatically by the server on `Apply`. |
| **Declarative Track** | Author resources as YAML files alongside `stigmer.yaml`. The CLI scans and applies them. |
| **SDK Track** | Author resources as code using a Stigmer SDK. The CLI runs the entry point to generate and apply resources. |

## Documentation Index

| Document | Description |
|---|---|
| [project-resource-guide.md](project-resource-guide.md) | Full YAML schema reference — metadata, spec fields, status fields, CLI commands |
| [declarative-track.md](declarative-track.md) | Directory layout, YAML resource files, and the declarative apply workflow |
| [sdk-track.md](sdk-track.md) | Entry-point execution, runtime inference, and SDK authoring patterns |
| [examples.md](examples.md) | Complete YAML examples from minimal to multi-resource projects |
| [validation-checklist.md](validation-checklist.md) | Pre-apply checklist and common pitfalls |

## How the CLI Applies a Project

```bash
stigmer project apply stigmer.yaml
```

The CLI performs the following steps regardless of which track is used:

1. Read `stigmer.yaml` to determine the project metadata and track (declarative vs SDK).
2. **Declarative**: scan the directory for YAML resource files and load them.  
   **SDK**: execute `entry_point` to synthesize resource definitions.
3. Apply each resource individually via its own RPC (e.g., `AgentCommandController.Apply`).
4. Collect the `ApiResourceReference` returned from each Apply response.
5. Call `ProjectCommandController.Apply` with the full membership list.
6. The server computes orphans (previous members − current members) and deletes them.
7. Return a `ReconciliationSummary` showing created, updated, and deleted resources.

The project resource itself holds no resource data — only references. This means projects are cheap to store and safe to apply frequently.
