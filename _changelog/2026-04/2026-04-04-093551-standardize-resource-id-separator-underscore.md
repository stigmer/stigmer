# Standardize Resource ID Separator: Hyphen to Underscore

**Date**: April 4, 2026

## Summary

Unified the resource ID separator from hyphen (`-`) to underscore (`_`) across the Go OSS codebase, aligning it with the Java cloud backend (`stigmer-cloud`) which already used underscore. This was a single-character production code change (`fmt.Sprintf("%s_%s", ...)`) with cascading updates across SDK codegen, proto documentation, generated docs, and test fixtures spanning 56 files.

## Problem Statement

The two codebases generated resource IDs with inconsistent separators:

- **stigmer-cloud (Java)**: `ApiResourceDefaultIdBuilder` produces `agt_01arz3ndek...` (underscore)
- **stigmer (Go OSS)**: `GenerateID` produces `agt-01arz3ndek...` (hyphen)

### Pain Points

- IDs created by the OSS server looked different from IDs created by the cloud server
- Proto documentation and SDK examples showed hyphenated IDs, contradicting cloud behavior
- The CLI reference parser already accepted both formats, hinting that the inconsistency was a known concern

## Solution

Changed the Go `GenerateID` function to use underscore as the prefix-to-ULID separator, matching the cloud Java implementation. Propagated the format change through all layers: codegen, proto documentation comments, generated SDK docs, and test fixtures.

## Implementation Details

### Core Change (1 line of production code)

`backend/libs/go/grpc/request/pipeline/steps/defaults.go` — changed `fmt.Sprintf("%s-%s", prefix, ulid)` to `fmt.Sprintf("%s_%s", prefix, ulid)`.

### SDK Codegen

`tools/codegen/generator/sdk_docs.go` — updated `docExampleID()` to join prefix and example ULID with underscore instead of hyphen. Updated `buildIdPrefixMap()` comment to reflect the new format.

### Proto Documentation (13 files)

Updated resource ID examples in documentation comments across workflow execution, workflow instance, IAM policy, MCP server, agent execution, and search proto files. Only the prefix-to-body separator was changed; hyphens within slugs and non-ID strings were preserved.

### Generated SDK Docs (17 files)

Re-ran `make gen-sdk-docs` to regenerate all `docs/sdk/*.mdx` files. Example IDs now show the underscore format (e.g., `agt_01j5q3k7m8r2s4tnz2hfp0q0c3`).

### Test Fixtures (15+ files)

Updated synthetic resource IDs in:
- Pipeline steps unit and integration tests
- Project, agent, workflow instance, and workflow execution controller tests
- Signal dedupe store tests
- CLI stream, history, approval, and followup tests
- MCP server apply and delete tests

### Backward Compatibility

The CLI reference parser (`client-apps/cli/pkg/reference/reference.go`) continues to accept both `_` and `-` separators, ensuring existing IDs in databases remain valid.

### Scope Discipline

Intentionally left unchanged:
- Resource names/slugs (`my-agent`, `web-search`)
- URL slugs in docs (`mcp-server.mdx`)
- Temporal workflow type strings (`stigmer/agent-execution/invoke`)
- Operational IDs (`discovery-`, `exec-ctx-`)
- UUID format (RFC-4122 hyphens)
- CLI command names (`mcp-server`)

## Benefits

- **Consistency**: OSS and cloud now generate identical ID formats
- **Clarity**: Underscore visually separates the type prefix from the ULID body more cleanly than hyphen, especially when the body itself may contain hyphens (UUIDs, compound slugs)
- **Documentation accuracy**: Proto comments, SDK docs, and examples now reflect the actual generated format

## Impact

- **All resource types**: Every API resource kind (`Agent`, `Workflow`, `Session`, `Project`, etc.) now produces underscore-separated IDs from the Go backend
- **SDK users**: Example code in all 17 SDK reference pages shows the correct format
- **CLI users**: No impact — the parser already accepts both formats
- **Cloud users**: No impact — cloud already used underscore

## Related Work

- Cloud Java implementation: `ApiResourceDefaultIdBuilder.java` (already correct, no changes)
- CLI reference parser: Dual-separator support predates this change

---

**Status**: ✅ Production Ready
**Timeline**: Single session
