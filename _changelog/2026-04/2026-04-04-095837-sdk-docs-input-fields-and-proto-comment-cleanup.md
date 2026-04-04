# SDK docs: show all input fields and clean proto comments

**Date**: April 4, 2026

## Summary

Expanded SDK code examples to show every input field with type-appropriate placeholders, replaced generic `input` in non-resource methods with actual field structures, and cleaned Agent proto comments for SDK-friendly documentation. Added proto message/field comment conventions to the document writer role.

## Problem Statement

### Pain Points

- SDK code examples only showed `name` and `org`, hiding 9+ other fields the user could set
- Go examples used `nil` for arrays and messages, which didn't communicate "fill this in"
- Methods like `updateVisibility` and `getDefault` showed a generic `input` variable instead of actual field structure
- Agent proto comments contained internal jargon ("Graphton configuration", "Template layer"), embedded YAML examples, decorative dividers, and implementation details that leaked into SDK docs
- No documented convention for proto message/field comments in the document writer role

## Solution

Three sets of changes addressing documentation quality at different layers.

### 1. Show all input fields in code examples

Modified `docWriteMethodSigs` in `sdk_docs.go` to dynamically generate all fields from `specSchema` instead of hardcoding `Name` and `Org`. Each field gets a type-appropriate placeholder value per language:

- **Go**: Typed empty literals (`[]stigmer.McpServerUsageInput{}`, `&stigmer.EnvSpecInput{}`, `map[string]string{}`)
- **TypeScript**: `[]` for arrays, `{}` for objects
- **Python**: `[]` for lists, `None` for messages
- **Java**: `List.of()` for lists, `null` for objects

### 2. Expand non-resource method examples

Methods like `updateVisibility`, `getDefault`, and `getByReference` previously showed `input` as a generic variable. Built a `methodTypeMap` from `schema.MethodTypes` and used it to look up field definitions for any proto input type, expanding ~55 methods across all 17 resources.

### 3. Agent proto comment cleanup

Reviewed and updated all Agent proto files (`api.proto`, `io.proto`, `spec.proto`, `status.proto`, `command.proto`, `query.proto`):

- Moved internal details (authorization, design principles, implementation notes) behind `@internal`
- Removed embedded YAML examples from spec.proto (now served by `overview.md`)
- Removed decorative dividers and markdown-style headers from proto comments
- Tightened field descriptions to work as standalone TypeTable descriptions
- Removed redundancies ("Created automatically" appearing twice)

## Implementation Details

### Generator changes (`sdk_docs.go`)

- Threaded `specSchema` through `docWriteMethods` → `docWriteMethod` → `docWriteMethodSigs`
- Added `docInputFields()` to build field tuples from metadata + spec fields for each language
- Added `docMethodTypeFields()` to build field tuples from `MethodTypeSchema` for default-case methods
- Added `docGoInputTypeName()` for consistent Go type naming (maps `EnvironmentSpec` → `EnvSpecInput`)
- Added `docPlaceholder()` with typed Go empty literals for arrays and messages
- Updated `default` case in `docWriteMethodSigs` to expand method types when fields are available

### Proto comment changes

- `api.proto`: Removed "Graphton configuration", added `@internal` marker
- `io.proto`: Cleaned `GetDefaultAgentRequest`, moved label resolution behind `@internal`
- `spec.proto`: Removed "Template layer", embedded YAML, design principles, HITL phase headers; moved internal details behind `@internal`; tightened all field descriptions
- `status.proto`: Removed redundant "Created automatically"
- `command.proto`: Moved authorization details behind `@internal`
- `query.proto`: Moved implementation details behind `@internal`

### Document writer role

Added "Proto message and field comment convention" section with rules for message comments (5 rules) and field comments (5 rules), placed after the existing RPC method comment convention.

## Benefits

- SDK users see the full shape of every input type at a glance in code examples
- Go examples show actual types instead of uninformative `nil`
- All method examples show real field structures, not generic `input`
- Proto comments produce clean, SDK-appropriate descriptions in generated docs
- Document writer conventions ensure consistency across future resources

## Impact

- All 17 SDK reference pages regenerated with expanded field examples
- Agent resource proto comments cleaned across 6 files
- JSON schemas regenerated from updated proto comments
- Document writer role updated for future consistency

## Related Work

- [Clickable proto types](2026-04-04-095410-clickable-proto-types-in-sdk-docs.md)
- [SDK docs auto-generation](2026-04-03-185754-sdk-docs-auto-generation-poc.md)
- [Audience-aware proto comments](2026-04-03-201354-audience-aware-proto-comments-sdk-docs.md)

---

**Status**: ✅ Production Ready
