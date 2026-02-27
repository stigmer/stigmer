---
name: Phase 1 Proto Changes
overview: Add WorkspaceSource and GitRepoSource proto messages to the session package, and extend SessionSpec with an optional workspace_source field. This is a purely additive, backward-compatible change that establishes the wire-protocol types for workspace provisioning.
todos:
  - id: create-workspace-proto
    content: Create apis/ai/stigmer/agentic/session/v1/workspace.proto with WorkspaceSource and GitRepoSource messages
    status: completed
  - id: modify-session-spec
    content: Add workspace_source field (position 6) to SessionSpec in spec.proto with import
    status: completed
  - id: buf-lint-breaking
    content: Run buf lint and buf breaking to validate proto changes
    status: completed
  - id: buf-generate
    content: Run buf generate to produce Go and Python stubs
    status: completed
  - id: update-build-bazel
    content: Add workspace.pb.go to BUILD.bazel srcs list
    status: completed
  - id: bazel-build-verify
    content: Run bazel build to verify Go stubs compile cleanly
    status: completed
isProject: false
---

# Phase 1: Proto Changes -- WorkspaceSource + GitRepoSource

## Domain Analysis (Architect Role)

### Critique of the Original Plan

**1. Wrapper type for `depth`: Rejected in favor of `optional int32`**

The original plan proposes `google.protobuf.Int32Value depth`. This codebase has **zero** usage of wrapper types across all proto files. Introducing `google/protobuf/wrappers.proto` as a new import pattern for a single field is unjustified overhead.

The modern proto3 approach is `optional int32 depth`, available since protobuf 3.15 (Jan 2021). It provides identical presence-tracking semantics -- `has_depth()` in generated code -- without a new dependency. The `optional` keyword is already used in this codebase for field extensions in `[apis/ai/stigmer/commons/apiresource/field_options.proto](apis/ai/stigmer/commons/apiresource/field_options.proto)`, so the syntax precedent exists even if it hasn't been used on regular message fields yet. This is the right time to adopt it for its intended purpose.

**2. Separate `branch` + `commit` vs single `ref`: Plan is correct**

The existing [`Git` message in skill/v1/synth.proto`](apis/ai/stigmer/agentic/skill/v1/synth.proto) uses a single` ref`field. The original plan proposes separate`branch`and`commit`fields for`GitRepoSource`. I agree with the plan -- these are different domain concepts:

- `branch` = which line of development to clone (efficient narrow fetch)
- `commit` = which exact state to pin to (reproducibility)

A single `ref` conflates "which branch to track" with "which exact state to materialize." Workspace provisioning needs both: "clone `main`, but pin to commit `a1b2c3d`." The skill synth use case is different (fetch-and-forget), so the divergence is appropriate.

**3. HTTPS validation: CEL expression, not pattern matching**

The codebase uses buf-validate CEL expressions for complex validation (e.g., kind checks on `ApiResourceReference`). The HTTPS check should follow this pattern rather than raw regex.

**4. `oneof source` should be required on `WorkspaceSource`**

A `WorkspaceSource` object without a source is an invalid state. The "no workspace source" case is represented by the absence of `workspace_source` on `SessionSpec` (field not set), NOT by an empty `WorkspaceSource{}`. Following the established pattern from `[McpServerSpec.server_type](apis/ai/stigmer/agentic/mcpserver/v1/spec.proto)` which uses `option (buf.validate.oneof).required = true`.

### What This Phase Does NOT Touch

- No runtime code changes (Python, Go)
- No workspace state enum (that's Phase 3, tied to execution flow)
- No `Attachment.local_path` (Phase 5)
- No auto-PR fields (deferred project)

---

## File Changes

### 1. NEW: `[apis/ai/stigmer/agentic/session/v1/workspace.proto](apis/ai/stigmer/agentic/session/v1/workspace.proto)`

New file containing `WorkspaceSource` and `GitRepoSource` messages.

```protobuf
syntax = "proto3";

package ai.stigmer.agentic.session.v1;

import "buf/validate/validate.proto";

// WorkspaceSource defines where the agent's workspace content comes from.
//
// This is a session-level concept: the workspace is provisioned once on the
// first execution and reused by subsequent executions in the same session.
// Changing the workspace source requires creating a new session.
//
// When workspace_source is absent on SessionSpec, the session uses an empty
// workspace (existing default behavior, no provisioning step).
//
// Local-path workspaces are a runner-level concern and do not appear in
// the wire protocol (see AD-09).
message WorkspaceSource {
  oneof source {
    option (buf.validate.oneof).required = true;
    GitRepoSource git_repo = 1;
  }
}

// GitRepoSource provisions a workspace by cloning a git repository.
//
// Authentication: The provisioner resolves GITHUB_TOKEN from the merged
// environment (Agent defaults < Environment < ExecutionContext.runtime_env)
// and injects it into the clone URL. The token is consumed by provisioning
// and stripped before forwarding to the agent runtime (see AD-05).
//
// HTTPS only for MVP. SSH key authentication is a future enhancement.
message GitRepoSource {
  // HTTPS clone URL (required).
  // Must use the https:// scheme. SSH URLs (git@...) are not supported.
  // Example: "https://github.com/acme/my-app.git"
  string url = 1 [
    (buf.validate.field).required = true,
    (buf.validate.field).cel = {
      id: "git_repo_source.url.https"
      message: "url must use HTTPS (e.g. https://github.com/org/repo). SSH URLs are not supported."
      expression: "this.startsWith('https://')"
    }
  ];

  // Branch to clone (optional).
  // When empty, the repository's default branch is used.
  // Example: "main", "develop", "feature/workspace-support"
  string branch = 2;

  // Commit SHA to checkout after cloning (optional).
  // When set, the workspace is checked out at this exact commit (detached HEAD).
  // When both branch and commit are set, the branch is cloned first, then
  // the commit is checked out -- this allows shallow clones of a specific
  // commit on a known branch.
  // When only commit is set (no branch), a full clone is required to
  // locate the commit.
  string commit = 3;

  // Clone depth (optional).
  //
  // Presence semantics:
  //   - Absent (not set): shallow clone with depth 1 (fast default).
  //   - 0: full clone with complete history.
  //   - N > 0: shallow clone with depth N.
  //
  // Uses proto3 optional to distinguish "not set" from "set to 0."
  optional int32 depth = 4 [
    (buf.validate.field).int32.gte = 0
  ];
}
```

Key design decisions in this file:

- `WorkspaceSource` as a wrapper message (not inline oneof on SessionSpec) to keep workspace config self-contained and extensible
- `oneof source` is required -- an empty `WorkspaceSource{}` is an invalid state
- `optional int32` for depth -- no wrapper types, uses modern proto3 presence tracking
- CEL expression for HTTPS validation -- follows established codebase pattern
- Comments reference architectural decisions (AD-05, AD-09) for traceability

### 2. MODIFY: `[apis/ai/stigmer/agentic/session/v1/spec.proto](apis/ai/stigmer/agentic/session/v1/spec.proto)`

Add import and `workspace_source` field at position 6.

```protobuf
import "ai/stigmer/agentic/session/v1/workspace.proto";

message SessionSpec {
  // ... existing fields 1-5 unchanged ...

  // Workspace source for this session (optional).
  //
  // Defines where the workspace content comes from. Provisioned on the
  // first execution; subsequent executions reuse the same workspace.
  //
  // When absent, the session uses an empty workspace directory
  // (existing behavior, fully backward-compatible).
  WorkspaceSource workspace_source = 6;
}
```

### 3. GENERATE: Run buf to produce Go + Python stubs

```bash
cd apis && buf generate
```

This produces:

- `apis/stubs/go/ai/stigmer/agentic/session/v1/workspace.pb.go`
- `apis/stubs/python/stigmer/ai/stigmer/agentic/session/v1/workspace_pb2.py`
- `apis/stubs/python/stigmer/ai/stigmer/agentic/session/v1/workspace_pb2.pyi`
- Updated `spec.pb.go` and `spec_pb2.py` (new field + import)

### 4. MODIFY: `[apis/stubs/go/ai/stigmer/agentic/session/v1/BUILD.bazel](apis/stubs/go/ai/stigmer/agentic/session/v1/BUILD.bazel)`

Add `workspace.pb.go` to `srcs`.

---

## Validation Checklist

After implementation, verify:

1. `**buf lint**` passes -- no new lint violations
2. `**buf breaking**` passes -- changes are additive only (new file, new optional field)
3. `**buf build**` succeeds -- proto compiles cleanly
4. **Bazel build** -- `bazel build //apis/stubs/go/ai/stigmer/agentic/session/v1:session` compiles
5. **Backward compatibility** -- existing `SessionSpec` without `workspace_source` is fully valid
6. **Invalid state unrepresentable** -- `WorkspaceSource{}` (empty oneof) rejected by validation

---

## Risk Assessment

- **Risk level**: Low (purely additive proto changes)
- **Breaking changes**: None. `workspace_source` is optional, `WorkspaceSource` is a new message
- **Downstream impact**: No runtime code changes. Generated stubs gain new types but no existing code references them yet

