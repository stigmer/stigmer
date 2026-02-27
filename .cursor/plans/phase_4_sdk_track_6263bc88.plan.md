---
name: Phase 4 SDK Track
overview: Adapt the SDK track to the reference-based model by replacing the deleted ProjectRuntime proto enum with a local Runtime type, updating the synthesis engine, and implementing the full SDK apply orchestration in executeProjectApply.
todos:
  - id: runtime-type
    content: Create apply/runtime.go with Runtime value object and InferRuntime() constructor
    status: completed
  - id: fix-synthesize
    content: Update synthesize.go and synthesize_test.go to use local Runtime type, remove projectv1 dependency
    status: completed
  - id: implement-sdk-flow
    content: Rewrite apply_project.go with full SDK apply orchestration (synthesize -> push skills -> apply resources -> collect refs -> apply project)
    status: completed
  - id: update-bazel
    content: Update BUILD.bazel files for both apply and root packages
    status: completed
  - id: verify-build
    content: Run go build and go test to verify everything compiles and passes
    status: completed
isProject: false
---

# Phase 4: Adapt SDK Track to Reference-Based Model

## Scope

Two self-contained changes:

- **A.** Fix the broken `apply` package by replacing the deleted `ProjectRuntime` proto enum with a local `Runtime` type.
- **B.** Replace the Phase 3 error stub in `executeProjectApply` with a working SDK apply flow that mirrors the declarative pattern: synthesize, apply resources individually, collect references, apply project.

## Domain Analysis (Architect Role)

### The Critique

The deleted `ProjectRuntime` enum was an anemic model problem -- it duplicated information already present in `entry_point`'s file extension. Phase 1 correctly removed it from the proto. However, the runtime concept is still a legitimate domain concern for the synthesis engine (it determines which command to execute). Replacing it with raw strings would be lazy. A proper value object is warranted.

### The Fix

Define `Runtime` as a strongly-typed string constant in the `apply` package (where it's consumed). Pair it with a `InferRuntime()` constructor that enforces validity -- impossible to create an invalid Runtime.

---

## File Changes

### Step 1: New file -- `[client-apps/cli/internal/cli/apply/runtime.go](client-apps/cli/internal/cli/apply/runtime.go)`

Define a `Runtime` value object that replaces `projectv1.ProjectRuntime`:

```go
type Runtime string

const (
    RuntimeGo     Runtime = "go"
    RuntimePython Runtime = "python"
    RuntimeNode   Runtime = "node"
)

func InferRuntime(entryPoint string) (Runtime, error)
```

- `InferRuntime` maps file extensions to runtimes: `.go` -> Go, `.py` -> Python, `.ts/.js/.mts/.mjs` -> Node
- Returns a descriptive error for unrecognized extensions (listing supported ones)
- Extension list must stay in sync with `supportedEntryPointExtensions` in `[client-apps/cli/internal/cli/project/validator.go](client-apps/cli/internal/cli/project/validator.go)` -- add a code comment cross-referencing

Estimated: ~50 lines.

### Step 2: Modify `[client-apps/cli/internal/cli/apply/synthesize.go](client-apps/cli/internal/cli/apply/synthesize.go)`

Mechanical type replacement (no logic changes):

- `SynthesizeOptions.Runtime`: `projectv1.ProjectRuntime` -> `Runtime`
- `getRuntimeCommand()`, `prepareRuntime()`, `formatExecutionError()`: parameter type `projectv1.ProjectRuntime` -> `Runtime`
- Switch cases: `projectv1.ProjectRuntime_go` -> `RuntimeGo`, etc.
- Validation: `projectv1.ProjectRuntime_project_runtime_unspecified` -> `Runtime("")` or a zero-value check
- **Remove `projectv1` import entirely** (no other references in this file)

### Step 3: Modify `[client-apps/cli/internal/cli/apply/synthesize_test.go](client-apps/cli/internal/cli/apply/synthesize_test.go)`

Same mechanical replacement of all `projectv1.ProjectRuntime_`* constants with local `Runtime`* constants. Remove `projectv1` import.

### Step 4: Rewrite `[client-apps/cli/cmd/stigmer/root/apply_project.go](client-apps/cli/cmd/stigmer/root/apply_project.go)`

Replace the error stub with a working SDK apply flow. The orchestration follows the same 7-phase structure as `[apply_declarative.go](client-apps/cli/cmd/stigmer/root/apply_declarative.go)`:

```
1. Infer runtime from entry_point extension  (apply.InferRuntime)
2. Run SDK synthesis                          (apply.Synthesize)
3. Load config, resolve org, connect backend  (shared pattern from declarative)
4. Push synthesized skills                    (skill.Push / skill.PushRemote per SkillSynth)
5. Apply synthesized resources                (agent.Apply, workflow.Apply, mcpserver.Apply)
6. Collect all references -> Project.Spec.Members -> project.Apply
7. Render structured summary
```

Key design decisions for this file:

- **Resources are full proto messages** from synthesis (not YAML bytes), so we call the internal `Apply()` functions directly (e.g., `agent.Apply()`) instead of going through the YAML -> `applyResourceItem` pipeline
- **Skills are pushed, not applied** -- iterate `synthesis.Result.SkillSynths`, dispatch to `skill.Push()` (LocalDir source) or `skill.PushRemote()` (Git source) based on the `oneof source` field
- **Ordering**: Push skills first, then apply agents/workflows/mcpservers (agents may reference skills)
- **Dry-run mode**: Skip backend connection and synthesis execution; show a preview of what would happen

Estimated: ~200-250 lines. If it exceeds 250 lines, split result builders into a companion file `apply_project_result.go`.

### Step 5: Update BUILD.bazel files

- `[client-apps/cli/internal/cli/apply/BUILD.bazel](client-apps/cli/internal/cli/apply/BUILD.bazel)`: Add `runtime.go` to `srcs`. Remove `//apis/stubs/go/ai/stigmer/agentic/project/v1:project` from `deps` (only `synthesize.go` used it).
- `[client-apps/cli/cmd/stigmer/root/BUILD.bazel](client-apps/cli/cmd/stigmer/root/BUILD.bazel)`: Verify `//client-apps/cli/internal/cli/skill` is in deps (may need to add it for skill push).

---

## Open Questions to Resolve During Implementation

### 1. Skill reference slug from push result

`SkillArtifactResult` returns `SkillName` but not `Slug`. To build an `ApiResourceReference` for project membership, we need a slug. Options:

- Use `SkillName` directly as the slug (if the backend uses name-as-slug for skills)
- Derive slug from name using a shared slugify function
- Add `Slug` to `SkillArtifactResult` (requires touching the artifact package)

**Recommendation**: Investigate what the backend returns during push and how the skill slug is derived. This will be resolved at implementation time -- I will pause and consult before assuming.

### 2. Skill Push takes `*grpc.ClientConn` (concrete type)

`skill.PushOptions.Conn` and `skill.RemotePushOptions.Conn` are typed as `*grpc.ClientConn` (concrete), while `agent.ApplyOptions.Conn`, `workflow.ApplyOptions.Conn`, etc. use `grpc.ClientConnInterface` (interface). Since `backend.NewConnection()` returns `*grpc.ClientConn`, this works in practice -- but it's an inconsistency worth noting. Not a Phase 4 concern, but should be tracked.

---

## What This Phase Does NOT Include

- **Extracting shared infrastructure** between declarative and SDK flows (config loading, org resolution, backend connection, project apply). Both flows will have some duplicated setup code. This is intentional -- premature extraction before both flows are stable risks over-abstraction. Can be revisited in Phase 5.
- **External skill verification** (`apply.VerifyExternalSkills`). The declarative flow doesn't verify external references either. Both flows let the backend handle missing references at execution time.
- **Dependency-ordered apply**. The synthesis package has topological ordering (`GetOrderedResources`), but the declarative flow applies in file order. Both flows rely on the backend's idempotent upsert semantics. Ordering can be added later if needed.

---

## Verification

After implementation:

- `go build ./cmd/stigmer/` -- CLI binary compiles
- `go test ./internal/cli/apply/...` -- Synthesis tests pass with new Runtime type
- `go test ./cmd/stigmer/root/...` -- Root package tests pass

