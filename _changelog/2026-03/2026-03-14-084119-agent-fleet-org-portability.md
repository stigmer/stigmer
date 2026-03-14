# Agent-Fleet Org Portability

**Date**: March 14, 2026

## Summary

Set `planton` as the project-level org in the agent-fleet repository and removed
hardcoded `org: default` from all resource YAMLs so they inherit org from the
project manifest. Updated all `tools/` draft scripts to ensure regenerated
resources also omit hardcoded org, codifying org portability as a standard
convention.

## Problem Statement

The agent-fleet repo had `org: default` hardcoded in every resource YAML
(`agents/infra-chart-composer.yaml`, `mcp-servers/mcp-server-planton.yaml`).
This conflicted with the org portability model established in the seedpack
rename (Task 1) and org inheritance guardrails (Task 2).

### Pain Points

- Resources carried a stale `org: default` that would fail to resolve after
  the seedpack's system org was renamed to `stigmer`
- The `stigmer draft` scripts regenerate these YAMLs and would reintroduce
  `org: default` on every run
- No project-level org was declared, so `stigmer apply` had no project-level
  org to inherit from

## Solution

Three-layer fix: set project org, strip resource org, and update generation
scripts so the fix survives regeneration.

## Implementation Details

### Project Manifest (`stigmer.yaml`)
Added `metadata.org: planton` — all resources in the project now inherit
`planton` as their org when applied via `stigmer apply`.

### Resource YAMLs
Removed `metadata.org: default` from both existing resources:
- `agents/infra-chart-composer.yaml`
- `mcp-servers/mcp-server-planton.yaml`

These now have no explicit org and inherit from the project manifest.

### Draft Script Prompts (7 scripts)
Added `== ORG PORTABILITY ==` section to every `stigmer draft` prompt that
generates Agent or McpServer YAML:
- `tools/00_onboard-planton-mcp-server.sh`
- `tools/01_generate-approval-policy.sh`
- `tools/04_draft-infra-chart-composer-agent.sh`
- `tools/06_draft-cloud-resource-assistant-agent.sh`
- `tools/08_draft-stack-job-troubleshooter-agent.sh`
- `tools/10_draft-planton-onboarding-guide-agent.sh`
- `tools/12_draft-service-pipeline-debugger-agent.sh`

Each instruction tells the draft agent: "Do NOT include metadata.org in the
generated YAML. Resources inherit their org from the project manifest
(stigmer.yaml). Hardcoding org in individual resource files breaks portability."

### Rule File (`tools/rules/generate-stigmer-draft-scripts.mdc`)
Added org portability to the DO NOT list, ensuring any future scripts
generated from this rule also include the instruction.

### Cross-Org Verification
Confirmed no cross-org references are needed — agent-fleet agents only
reference `mcp-server-planton` (same project). No seedpack resources
(`mcp-server-stigmer`, etc.) are referenced.

## Benefits

- Agent-fleet resources are now org-portable: change `metadata.org` in one
  file (`stigmer.yaml`) to deploy the entire fleet to a different org
- Regenerating resources via `tools/` scripts produces clean, org-free YAML
- Zero `org: default` references remain in the repo
- Convention is codified in the rule file for future script authors

## Impact

- **agent-fleet repo**: 11 files changed (3 YAML, 7 scripts, 1 rule)
- **stigmer repo**: 2 project tracking files updated (tasks.md, next-task.md)
- Part of project `20260314.02.org-portability-seedpack-apply` (Task 4 of 5)

## Related Work

- [Rename seedpack system org to stigmer](2026-03-14-080928-rename-seedpack-system-org-to-stigmer.md) — Task 1
- Org inheritance guardrails (`warnOrgMismatch`, `STIGMER_SEEDPACK_ORG`) — Task 2
- End-to-end validation — Task 5 (next)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
