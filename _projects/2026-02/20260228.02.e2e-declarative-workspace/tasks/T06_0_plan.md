# T06: Customer-Facing Documentation

**Status**: PENDING
**Created**: 2026-02-28
**Depends On**: T03 (seedpack reference), T04 (workspace commands)

## Objective

Create comprehensive documentation so customers can follow the same path as the seedpack: create projects, draft resources, apply them, and run agents with workspace provisioning. The seedpack serves as the canonical reference example.

## Documentation Deliverables

### 6.1 Seedpack README

**File**: `backend/services/stigmer-server/pkg/seedpack/README.md`

Contents:
1. What is the Seedpack — default resources bootstrapped with every server
2. Project Structure — explain `stigmer.yaml`, `skills/`, `agents/`, `mcp-servers/`
3. What's Inside — table of all 7 resources with descriptions
4. How Bootstrap Works — server startup applies these idempotently
5. Regenerating Content — how to re-run `tools/` scripts
6. Vendoring External Skills — Anthropic skill-creator provenance

### 6.2 Getting Started Guide

**File**: TBD (docs/ directory or wiki)

Walk the customer through creating their first project:

```
1. Install and start Stigmer
   stigmer server start

2. Create a project
   mkdir my-agents && cd my-agents
   # Create stigmer.yaml

3. Draft your first skill
   stigmer draft skill -m "..."

4. Draft your first agent
   stigmer draft agent -m "..."

5. Apply the project
   stigmer apply

6. Run your agent
   stigmer run agent my-agent -m "..."
```

### 6.3 `stigmer.yaml` Format Reference

Document the project marker file:
- `apiVersion`: `agentic.stigmer.ai/v1`
- `kind`: `Project`
- `metadata.name`: required, kebab-case
- `metadata.org`: optional (defaults to context org)
- `spec.entry_point`: optional (presence → SDK track, absence → declarative track)
- `spec.description`: optional
- `spec.members`: server-managed (do not set manually)

### 6.4 Declarative Track Guide

Explain the directory scanning behavior:
- Top-level YAML files are detected and applied
- Immediate subdirectories with YAML files are also scanned (one level)
- Subdirectories with `SKILL.md` are pushed as skills
- `stigmer.yaml` itself is excluded from scanning
- `--prune` flag removes orphaned resources

### 6.5 Workspace Provisioning Guide

Explain the three workspace modes:
- Empty (default): Agent gets a fresh workspace
- Git: `--workspace https://github.com/user/repo` clones the repo
- Local path: `--workspace /path/to/dir` uses an existing directory

Cover:
- Platform file isolation (`.stigmer/` lives outside workspace)
- Credential scoping (GITHUB_TOKEN consumed and stripped)
- Git diff artifacts

### 6.6 `stigmer draft` Command Reference

Document:
- `stigmer draft skill` — creates SKILL.md packages
- `stigmer draft agent` — creates Agent YAML files
- Common flags: `-m`, `--attach`, `--output`, `--model`
- How it works: uses system agents from seedpack bootstrap

## Writing Guidelines

- Customer-first language (not internal architecture)
- Include runnable examples (copy-paste ready)
- Progressive disclosure (start simple, link to details)
- Reference the seedpack as the canonical example project
- Test all examples before publishing

## Success Criteria

- New user can go from zero to running agent in < 10 minutes following the guide
- Seedpack README explains the project structure clearly
- All CLI commands documented with examples
- Workspace provisioning documented with all three modes
