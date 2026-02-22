# Add `extract` Field to Attachment Proto — Directory Zip Support Foundation

**Date**: February 22, 2026

## Summary

Added a `bool extract` field to the `Attachment` protobuf message, laying the foundation for directory attachment support in the `--attach` CLI flag. This enables the agent runner to distinguish between "write as file" and "extract as archive" behaviors when injecting attachments into execution sandboxes.

## Problem Statement

The `--attach` flag only supports individual files. Attaching a directory of input files requires listing each file separately, which is tedious and error-prone for multi-file workflows like skill creation.

### Pain Points

- Users must enumerate every file individually with `--attach` for directory inputs
- No mechanism exists to signal that an uploaded zip should be extracted at the mount path
- The `Attachment` proto had a stale `reserved 2` field from a removed inline content approach

## Solution

Added an explicit `bool extract` field to the `Attachment` proto message. When set to `true`, the agent runner will extract the zip archive at `mount_path` rather than writing it as a single file. This is the proto-layer foundation — CLI zipping (T03) and runner extraction (T04) will consume this field in subsequent tasks.

Chose an explicit flag over content-type inference because a user may intentionally attach a `.zip` file that should remain as-is (e.g., a dataset the agent processes directly).

## Implementation Details

- Removed `reserved 2` from `Attachment` message and renumbered fields to a clean 1-5 sequence
- Added `bool extract = 5` with documentation explaining its purpose and auto-set behavior
- Regenerated Go and Python stubs via `make -C apis build` (buf generate + gazelle)
- Updated the MCP server's hand-maintained `AttachmentInput` struct and `toProto()` method

### Final Proto Shape

```protobuf
message Attachment {
  string filename = 1;
  string storage_key = 2;
  string mount_path = 3;
  string content_type = 4;
  bool extract = 5;
}
```

## Benefits

- Clean proto schema with no legacy reserved slots
- Explicit extraction intent — no ambiguity about zip handling
- Zero behavioral change — `extract` defaults to `false`, all existing paths work identically
- Foundation ready for T03 (CLI directory zipping) and T04 (runner extraction)

## Impact

- **APIs**: `Attachment` message in `agentexecution/v1/spec.proto` — new field
- **Go stubs**: Regenerated with `Extract` field and `GetExtract()` accessor
- **Python stubs**: Regenerated with `extract` field
- **MCP server**: `AttachmentInput` struct updated with `Extract` field
- **No behavioral changes**: All consumers continue to work — the field is additive

## Related Work

- Part of project `20260222.01.fix-attach-directory-zip-support`
- Next: T03 (CLI directory zipping), T04 (agent runner extraction), T05 (integration testing)

---

**Status**: In Progress (T02 of 5 complete)
**Timeline**: ~30 minutes
