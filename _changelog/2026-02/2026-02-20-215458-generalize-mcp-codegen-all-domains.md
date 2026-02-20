# Generalize MCP Server Codegen to All Domains

**Date**: February 20, 2026

## Summary

Expanded the MCP server codegen pipeline from 3 manually-configured resources to 15 auto-discovered resources across all 3 domains (agentic, iam, tenancy). A single `make codegen` command replaces per-resource Makefile entries. Discriminated union metadata is now declared in the proto itself via custom options, making the proto the single source of truth.

## Problem Statement

The MCP server Makefile required a manual entry per resource with explicit CLI flags. Adding a new resource meant editing the Makefile. The `--expand-struct` flag hardcoded discriminated union relationships that the proto author already knew.

### Pain Points

- Manual Makefile entry per resource — 3 lines for 3 resources, would grow to 16+
- `--expand-struct=task_config:kind:../tools/codegen/schemas/tasks` hardcoded in CLI
- Only 3 of 16 API resources had generated MCP input types
- Flat gen/ directory structure didn't reflect domain hierarchy
- No automated discovery — each new resource required human intervention

## Solution

Six-phase implementation making the proto the single source of truth:

1. **Proto custom options** — `discriminated_by` on Struct fields, `discriminator_value` on variant messages
2. **proto2schema enhancement** — extracts custom options into JSON schema metadata
3. **Generator comprehensive mode** — auto-discovers domain/resource pairs from schema directory
4. **Schema-driven expand-struct** — replaces CLI flag with metadata-driven detection
5. **Domain-scoped gen/ layout** — `gen/{domain}/{resource}/` mirrors proto namespace
6. **Single Makefile command** — `make codegen` runs the full pipeline

## Implementation Details

### Custom Proto Options

Added two new extensions to `field_options.proto`:

- `discriminated_by` (field option 90205): marks a `google.protobuf.Struct` field as a discriminated union, value is the sibling discriminator field name
- `discriminator_value` (message option 90301): marks a message as a typed variant, value is the enum string it corresponds to

Applied to: `WorkflowTask.task_config` + 13 task config messages.

### proto2schema Custom Option Extraction

Implemented `extractDiscriminatedBy()` and `extractDiscriminatorValue()` using protowire to read string values from proto unknown fields. Both metadata types appear in JSON schemas as `discriminatedBy` and `discriminatorValue` fields.

### Generator Comprehensive Mode

New `--comprehensive` flag triggers:
- `discoverDomains()` — walks schema root, identifies domain directories (contain resource subdirs) vs satellite directories (contain variant schemas)
- `indexSatellites()` — loads variant schemas from non-domain directories
- `detectExpandStructFromSchema()` — matches `discriminatedBy` metadata in shared types against `discriminatorValue` in satellites
- `runComprehensiveMCP()` — iterates domain/resource pairs, creates per-resource generators

### Restructured Output

```
mcp-server/gen/
  agentic/  agent, agentexecution, agentinstance, environment, executioncontext,
            mcpserver, skill, workflow, workflowexecution, workflowinstance
  iam/      apikey, iampolicy, identityaccount, identityprovider
  tenancy/  organization
```

## Benefits

- **Zero maintenance**: Adding a new API resource to protos automatically includes it in MCP codegen
- **Single command**: `make codegen` generates schemas + 15 MCP input type packages
- **Proto as source of truth**: Discriminated union metadata lives in the proto, not CLI flags
- **Domain organization**: Generated code mirrors the proto namespace hierarchy
- **Future-proof**: New domains and resources are picked up automatically

## Impact

- **Codegen tools**: `proto2schema` and `generator` both enhanced with comprehensive mode
- **Proto definitions**: 16 proto files annotated with custom options (1 field + 13 message options)
- **MCP server**: gen/ restructured from flat to domain-scoped; 9 import paths updated
- **Makefile**: 3 manual lines → 1 comprehensive command + 2 supporting targets
- **Generated output**: 15 new `_gen.go` files with `*Input` structs and `ToProto()` methods

## Related Work

- [Typed Workflow Task Configs](2026-02-20-210846-typed-workflow-task-configs-mcp-codegen.md) — Session 7, added expand-struct CLI flag
- [MCP Server Final Validation](2026-02-20-192544-mcp-server-final-validation.md) — Session 6, validated core pipeline

---

**Status**: ✅ Production Ready
**Timeline**: Session 8 (February 20, 2026)
