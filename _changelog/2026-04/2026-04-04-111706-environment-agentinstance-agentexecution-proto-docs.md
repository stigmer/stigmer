# Proto Documentation: Environment, AgentInstance, and AgentExecution

**Date**: April 4, 2026

## Summary

Improved proto documentation across three API resource packages — Environment, AgentInstance, and AgentExecution — so the auto-generated SDK reference pages show complete, accurate descriptions for every message, field, enum value, and RPC method. Created missing `overview.md` files for all three resources to give each SDK reference page a proper introduction with a representative YAML example.

## Problem Statement

The SDK docs generator (`tools/codegen/generator/sdk_docs.go`) extracts documentation from proto comments using `docFirstSentence` and `docStripInternal`. When proto comments are missing, vague, or leak internal implementation details into SDK-facing content, the generated documentation has empty cells, confusing descriptions, or information that is irrelevant to SDK consumers.

### Pain Points

- Several fields across the three resources had no description at all, producing empty cells in TypeTable rows
- Internal implementation details (authorization, encryption, Graphton) were leaking into SDK-facing first sentences
- `Example:` blocks in field comments cluttered the first sentence extraction
- Redundant annotations like "(required)" and "(optional)" duplicated what validation rules already convey
- Missing `overview.md` files meant the SDK reference pages fell back to generic proto-based overviews
- The `@internal` marker was missing from most RPCs, so there was no clean separation between SDK-facing and internal-only content
- The `docs/README.md` Proto Source table for Environment was outdated, missing RPCs and messages added after the initial file was written

## Solution

Applied the conventions from the Document Writer role (`_roles/002_document_writer.md`) and the Agent resource protos (the quality reference) across all three resources. Each proto file was audited for:

1. **First-sentence quality** — every message, field, and RPC has a concise first sentence that works standalone in a table row
2. **`@internal` separation** — implementation details, authorization notes, and design rationale moved behind `@internal`
3. **No leaked examples** — `Example:` blocks removed from SDK-facing content or moved behind `@internal`
4. **No redundant annotations** — removed "(required)" and "(optional)" where validation rules already express the constraint
5. **`overview.md` creation** — SDK-register introduction with representative YAML for each resource

## Implementation Details

### Environment (`apis/ai/stigmer/agentic/environment/v1/`)

- **overview.md**: Created with 3-sentence description and YAML showing both secret and non-secret values
- **api.proto**: Tightened `Environment` message comment; moved visibility detail to `@internal`; made `spec` description concrete
- **spec.proto**: Removed all `Example:` blocks; rewrote vague "The actual value." to "The configuration or secret string."; moved encryption/storage behavior behind `@internal`
- **io.proto**: Added missing `EnvironmentId.value` description; moved design rationale to `@internal`; cleaned redundant annotations
- **query.proto**: Added `@internal` to `get`; improved `getByReference` with reference example; moved "Creator-only" to `@internal` on `getSecretValue`
- **command.proto**: Rewrote `apply` description; added `@internal` with authorization details to all RPCs
- **docs/README.md**: Updated Proto Source table with all current RPCs and IO messages

### AgentInstance (`apis/ai/stigmer/agentic/agentinstance/v1/`)

- **overview.md**: Created with description of instance as a runtime configuration binding
- **api.proto**, **spec.proto**, **io.proto**, **query.proto**, **command.proto**: Applied same conventions — clean first sentences, `@internal` separation, authorization details behind `@internal`

### AgentExecution (`apis/ai/stigmer/agentic/agentexecution/v1/`)

- **overview.md**: Created with description of execution as a single conversation run
- **api.proto**, **spec.proto**, **enum.proto**, **query.proto**, **command.proto**, **writeback.proto**: Applied same conventions; particular focus on enum values which had missing or empty descriptions that would show as blank rows in SDK docs

## Benefits

- Every field in the generated SDK TypeTables now has a meaningful description
- Every RPC in the generated Methods overview table has a clean, verb-first summary
- Every enum value has a description (previously many were blank)
- SDK consumers no longer see internal authorization or encryption details in the public reference
- Each SDK reference page opens with a clear introduction and YAML example instead of a generic fallback
- Internal developers still have full implementation context via `@internal` sections

## Impact

- **SDK documentation quality**: All three resource SDK reference pages are now complete — no empty cells, no leaked internals
- **Consistency**: Environment, AgentInstance, and AgentExecution now match the quality standard set by the Agent resource
- **Maintainability**: The `@internal` convention is consistently applied, making future documentation updates straightforward

## Related Work

- `2026-04-03-201354-audience-aware-proto-comments-sdk-docs.md` — established the `@internal` convention and applied it to the Agent resource
- `2026-04-04-110432-sdk-docs-enums-commons-and-cross-page-links.md` — added enum rendering and cross-page links to the SDK docs generator

---

**Status**: ✅ Production Ready
**Timeline**: Single session
