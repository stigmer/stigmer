# Phase 1 Content Strategy Review and Consistency Fixes

**Date**: March 31, 2026

## Summary

Completed the Phase 1 review of all five content strategy deliverables (positioning, vocabulary guide, demo story, use cases, information architecture) and applied consistency fixes across the README, vocabulary guide, and three design-decision documents. The review confirmed Phase 2 readiness and surfaced a platform-documentation alignment issue around approval flow framing that was resolved collaboratively.

## Problem Statement

Phase 1 produced five deliverables across six sessions. Before beginning Phase 2 (sales website content), the deliverables needed a cross-document review to verify internal consistency, vocabulary compliance, and Phase 2 readiness. The vocabulary guide also had six known inconsistencies requiring investigation and resolution.

### Pain Points

- The OSS README used "agentic automation platform" — a term explicitly rejected by the positioning document
- The README's Agent YAML example used `mcpServers`, a non-existent YAML alias (strict protojson unmarshal rejects it)
- Three documents (positioning, demo story, use cases) described approval flows as threshold-based ("refunds over $500") when the platform actually provides per-tool binary approval
- The vocabulary guide referenced a "user-facing YAML shorthand" that was never implemented

## Solution

Performed a structured review of all deliverables in dependency order, investigated the codebase for two inconsistencies requiring code-level verification, and applied fixes collaboratively with the project owner.

## Implementation Details

### Files Modified (6)

- **README.md**: Category name corrected; Agent YAML example updated to real `mcp_server_usages` structure with `McpServerUsage` entries
- **docs/vocabulary.md**: Agent and MCP Server entries updated to remove shorthand claims; bad example corrected; inconsistencies #1 and #5 marked RESOLVED
- **design-decisions/positioning.md**: Pillar 3 product feature description and proof point reframed for tool-level approval
- **design-decisions/demo-story.md**: Act 3 rewritten to show tool-level approval; property management variant updated
- **design-decisions/use-cases.md**: HR use case equipment approval reframed from budget threshold to action type

### Key Design Decision

Approval flows in Stigmer are per-tool (binary: a tool either requires approval or doesn't). Conditional logic — dollar thresholds, escalation routing, risk scoring — is the user's responsibility built on top of the approval primitive. All customer-facing copy now reflects this separation of concerns.

### Codebase Investigation Results

- **Vocabulary inconsistency #4**: "Credential" in the Cloud README is a phantom resource — no `Credential` kind exists in `api_resource_kind.proto`. Deferred to Cloud repo.
- **Vocabulary inconsistency #5**: `mcpServers` is not a supported YAML alias. The CLI agent loader uses strict protojson with `DiscardUnknown: false`. Tests confirm `mcp_server_usages` is the correct field.

## Benefits

- All Phase 1 deliverables are now internally consistent and accurately represent platform capabilities
- The README's Agent YAML example will actually work if copy-pasted into a file and applied
- The approval narrative is honest about what the platform provides vs. what the user designs
- Two vocabulary inconsistencies resolved; four others triaged with clear disposition

## Impact

- **Content strategy project**: Phase 1 is now reviewed and approved. Phase 2 can begin.
- **README**: More accurate first impression for GitHub visitors
- **Vocabulary guide**: Inconsistency register partially cleared; remaining items tracked with disposition

## Related Work

- Phase 1 deliverables: Sessions 1–6 of the content strategy project
- Next: Phase 2 (sales website content implementation) or pre-Phase 3 housekeeping

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
