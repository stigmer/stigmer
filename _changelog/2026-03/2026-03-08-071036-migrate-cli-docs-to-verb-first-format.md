# Migrate All CLI Documentation to Verb-First Command Format

**Date**: March 8, 2026

## Summary

Updated every CLI command reference across 30 source-of-truth files — proto API docs, product docs, guides, examples, and the mcp-server-creator agent definition — from the deprecated type-first syntax (`stigmer <type> <verb>`) to the current verb-first syntax (`stigmer <verb> <type>`). This eliminates the root cause of agents executing incorrect shell commands learned from stale documentation.

## Problem Statement

When running `stigmer draft mcp-server` (via `01_generate-approval-policy.sh` in the agent-fleet repo), the mcp-server-creator agent attempted to execute `stigmer mcp-server get planton --output yaml` — the old, deprecated command format. The correct command is `stigmer get mcp-server planton --output yaml`.

### Pain Points

- The agent was not explicitly told to run this command — it learned it from the **mcp-server-creator SKILL.md**, which was generated from proto API docs that still contained old-format CLI examples
- The CLI migrated to verb-first format (`stigmer get agent` instead of `stigmer agent get`) but the documentation across APIs, product docs, guides, and examples was never updated
- Old commands in source-of-truth docs propagated into auto-generated skills, which then propagated into agent behavior — a documentation debt amplification chain
- The old format commands fail silently or produce confusing errors at runtime

## Solution

Systematic find-and-replace across all documentation that serves as input to skill generation or is browsable by agents during execution. The transformation follows the migration table in `client-apps/cli/COMMANDS.md`:

| Old Format | New Format |
|---|---|
| `stigmer <type> apply -f file.yaml` | `stigmer apply -f file.yaml` |
| `stigmer <type> get <ref>` | `stigmer get <type> <ref>` |
| `stigmer <type> list` | `stigmer list <type>` |
| `stigmer <type> delete <ref>` | `stigmer delete <type> <ref>` |
| `stigmer <type> search "q"` | `stigmer search <type> "q"` |
| `stigmer <type> run <ref>` | `stigmer run <type> <ref>` |

## Implementation Details

### Files Modified (30 total)

**Proto API Docs (10 files)** — Primary source of truth for skill generation:
- `apis/ai/stigmer/agentic/mcpserver/docs/` — 5 files (mcpserver-resource-guide, validation-checklist, tool-approval-policies, capability-discovery, examples)
- `apis/ai/stigmer/agentic/agent/docs/` — 3 files (agent-resource-guide, validation-checklist, mcp-server-integration)
- `apis/ai/stigmer/tenancy/project/docs/validation-checklist.md`
- `apis/ai/stigmer/tenancy/organization/docs/validation-checklist.md`

**Product Docs (5 files)** — Browsable during generation:
- `docs/product/what-is-mcp-server.md`, `what-is-project.md`, `what-is-organization.md`, `what-is-agent.md`, `what-is-stigmer-server.md`

**Guides and CLI Docs (6 files):**
- `docs/guides/stigmer-projects.md`, `deploying-with-apply.md`, `creating-and-versioning-skills.md`
- `docs/cli/managing-agents.md` (58 replacements — largest single file), `configuration.md`
- `docs/getting-started/local-mode.md`

**Architecture Docs (3 files):**
- `docs/architecture/backend-modes.md`, `org-slug-ownership-model.md`, `workflow-execution-lifecycle.md`

**Examples (4 files):**
- `examples/README.md`, `examples/project/README.md`, `examples/project/minimal-go.yaml`, `examples/project/node-api-service.yaml`

**Backend (1 file):**
- `backend/services/stigmer-server/pkg/query/search/README.md`

**Seedpack Agent Definition (1 file):**
- `seedpack/agents/mcp-server-creator.yaml` (line 115)

### Intentionally NOT Modified

- `seedpack/skills/` — Auto-generated, will be regenerated from the now-corrected source docs
- `client-apps/cli/COMMANDS.md` — Migration table intentionally documents old → new mapping
- `_changelog/` and `_projects/` — Immutable historical records

## Benefits

- **Eliminates agent command failures**: Regenerated skills will teach agents the correct verb-first syntax
- **Breaks the amplification chain**: Source docs → skills → agents now all use consistent, correct commands
- **Single source of truth**: The CLI's actual behavior and all documentation are now aligned
- **Future-proof**: No more drift between CLI implementation and documentation

## Impact

- All proto API docs that feed into `03_draft-mcp-server-creator-skill.sh` and `02_draft-agent-creator-skill.sh` are now correct
- The `01_generate-approval-policy.sh` workflow in agent-fleet will work correctly after skills are regenerated
- Any developer or agent browsing the docs will see the current CLI syntax

## Related Work

- CLI verb-first migration (original implementation, Feb 2026)
- `_changelog/2026-02/2026-02-16-233054-update-agent-docs-to-verb-first-cli.md` — Earlier partial attempt that missed many files

---

**Status**: ✅ Production Ready
**Timeline**: Single session
