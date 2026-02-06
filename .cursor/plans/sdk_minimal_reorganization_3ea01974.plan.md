---
name: SDK Minimal Reorganization
overview: "Reorganize the Go SDK with surgical changes to improve clarity: rename stigmer/ to context/, promote ref/ from commons/ to top-level, move templates/ to internal/, and consolidate metadata/ appropriately."
todos:
  - id: phase-1-directories
    content: Create new directory structure (context/, ref/, metadata/, internal/templates/)
    status: completed
  - id: phase-2-stigmer
    content: Move stigmer/ to context/ and update ~38 import statements
    status: completed
  - id: phase-3-ref
    content: Move commons/ref/ to ref/ and update ~18 import statements
    status: completed
  - id: phase-4-metadata
    content: Move commons/metadata/ to metadata/ and update imports
    status: completed
  - id: phase-5-cleanup
    content: Delete empty commons/ directory
    status: completed
  - id: phase-6-templates
    content: Move templates/ to internal/templates/
    status: completed
  - id: phase-7-docs
    content: Update all documentation with new import paths
    status: completed
  - id: phase-8-build
    content: Update Makefile, BUILD.bazel, and .cursor/rules files
    status: completed
  - id: phase-9-validate
    content: Run go build, go test, go vet to verify everything works
    status: completed
isProject: false
---

# SDK Minimal Reorganization Plan

## Current Structure vs Target Structure

```
CURRENT                              TARGET
sdk/go/                              sdk/go/
├── stigmer/          ──────────►    ├── context/           (renamed - clearer purpose)
│   └── naming/                      │   └── naming/
├── commons/                         ├── ref/               (promoted from commons/)
│   ├── ref/          ──────────►    ├── metadata/          (promoted from commons/)
│   └── metadata/     ──────────►    ├── internal/
├── templates/        ──────────►    │   ├── templates/     (moved - internal utility)
├── internal/                        │   ├── validation/
│   ├── validation/                  │   └── synth/
│   └── synth/                       ├── agent/             (unchanged)
├── agent/                           ├── workflow/          (unchanged)
├── workflow/                        ├── skill/             (unchanged)
├── skill/                           ├── mcpserver/         (unchanged)
├── mcpserver/                       ├── environment/       (unchanged)
├── environment/                     ├── gen/               (unchanged)
├── gen/                             ├── examples/          (unchanged)
├── examples/                        └── docs/              (unchanged)
└── docs/
```

## Impact Analysis


| Package                              | Files Affected    | Import Consumers      |
| ------------------------------------ | ----------------- | --------------------- |
| `stigmer/` → `context/`              | 6 files + naming/ | ~38 files             |
| `commons/ref/` → `ref/`              | 7 files           | ~18 files             |
| `commons/metadata/` → `metadata/`    | 2 files           | ~1 file               |
| `templates/` → `internal/templates/` | 4 files           | Self-referential only |


**Total files to move**: 19 files
**Total import updates**: ~57 files (some overlap)

## Step-by-Step Implementation

### Phase 1: Create New Directory Structure

Create the target directories before moving files:

- `sdk/go/context/`
- `sdk/go/context/naming/`
- `sdk/go/ref/`
- `sdk/go/metadata/`
- `sdk/go/internal/templates/`

### Phase 2: Move stigmer/ to context/

**Files to move**:

- `stigmer/context.go` → `context/context.go`
- `stigmer/context_test.go` → `context/context_test.go`
- `stigmer/refs.go` → `context/refs.go`
- `stigmer/refs_test.go` → `context/refs_test.go`
- `stigmer/doc.go` → `context/doc.go`
- `stigmer/naming/slug.go` → `context/naming/slug.go`
- `stigmer/naming/slug_test.go` → `context/naming/slug_test.go`

**Package declarations to update**:

- Change `package stigmer` → `package context`
- Change `package naming` (stays the same, just moved)

**Import path changes** (~38 files):

```go
// Before
import "github.com/stigmer/stigmer/sdk/go/stigmer"
import "github.com/stigmer/stigmer/sdk/go/stigmer/naming"

// After
import "github.com/stigmer/stigmer/sdk/go/context"
import "github.com/stigmer/stigmer/sdk/go/context/naming"
```

**Key files affected**:

- [sdk/go/agent/agent.go](sdk/go/agent/agent.go) - Uses `stigmer.Context`
- [sdk/go/workflow/workflow.go](sdk/go/workflow/workflow.go) - Uses `stigmer.Context`
- [sdk/go/environment/environment.go](sdk/go/environment/environment.go) - Uses `stigmer.Context`
- All 19 examples in `sdk/go/examples/`
- Documentation files in `sdk/go/docs/`

### Phase 3: Move commons/ref/ to ref/

**Files to move**:

- `commons/ref/skill.go` → `ref/skill.go`
- `commons/ref/skill_test.go` → `ref/skill_test.go`
- `commons/ref/mcpserver.go` → `ref/mcpserver.go`
- `commons/ref/mcpserver_test.go` → `ref/mcpserver_test.go`
- `commons/ref/environment.go` → `ref/environment.go`
- `commons/ref/environment_test.go` → `ref/environment_test.go`
- `commons/ref/errors.go` → `ref/errors.go`
- `commons/ref/errors_test.go` → `ref/errors_test.go`
- `commons/ref/doc.go` → `ref/doc.go`

**Package declaration**: Change `package ref` (stays the same)

**Import path changes** (~18 files):

```go
// Before
import "github.com/stigmer/stigmer/sdk/go/commons/ref"

// After
import "github.com/stigmer/stigmer/sdk/go/ref"
```

### Phase 4: Move commons/metadata/ to metadata/

**Files to move**:

- `commons/metadata/annotations.go` → `metadata/annotations.go`
- `commons/metadata/doc.go` → `metadata/doc.go`

**Import path changes** (~1 file):

```go
// Before
import "github.com/stigmer/stigmer/sdk/go/commons/metadata"

// After
import "github.com/stigmer/stigmer/sdk/go/metadata"
```

### Phase 5: Delete Empty commons/ Directory

After moving `ref/` and `metadata/`, the `commons/` directory will be empty. Delete it.

### Phase 6: Move templates/ to internal/templates/

**Files to move**:

- `templates/templates.go` → `internal/templates/templates.go`
- `templates/templates_test.go` → `internal/templates/templates_test.go`
- `templates/README.md` → `internal/templates/README.md`
- `templates/BUILD.bazel` → `internal/templates/BUILD.bazel`

**Import path changes** (only internal):

```go
// Before
import "github.com/stigmer/stigmer/sdk/go/templates"

// After
import "github.com/stigmer/stigmer/sdk/go/internal/templates"
```

**Note**: This makes templates unexportable to external consumers (correct behavior for internal utility).

### Phase 7: Update Documentation

Update all documentation files that reference old import paths:

- `sdk/go/README.md`
- `sdk/go/docs/README.md`
- `sdk/go/docs/getting-started.md`
- `sdk/go/docs/USAGE.md`
- `sdk/go/docs/API_REFERENCE.md`
- `sdk/go/docs/api-reference.md`
- `sdk/go/docs/architecture/*.md`
- `sdk/go/docs/guides/*.md`

### Phase 8: Update Build Files

- Update `sdk/go/Makefile` if it references old paths
- Update `sdk/go/BUILD.bazel` if it references old paths
- Update any `.cursor/rules/` files with old paths

### Phase 9: Validation

Run all quality gates:

```bash
cd sdk/go
go build ./...          # Verify compilation
go test ./...           # Verify all tests pass
go vet ./...            # Verify no issues
```

## Naming Rationale


| Change                               | Reason                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `stigmer/` → `context/`              | Clearer purpose: manages resource context and registration               |
| `commons/ref/` → `ref/`              | Not "common" - it's a first-class domain concept for resource references |
| `commons/metadata/` → `metadata/`    | Promotes from nested utility to proper SDK concern                       |
| `templates/` → `internal/templates/` | Hides internal utility from public API surface                           |


## Risk Mitigation

- **Breaking change**: All import paths change. This is acceptable per user confirmation.
- **Git history**: Use `git mv` to preserve file history where possible.
- **Atomic commits**: Each phase should be a separate commit for easy rollback.
- **Testing**: Run full test suite after each phase before proceeding.

## After Reorganization

The new structure better communicates SDK architecture:

- **Root packages** = Public API (agent, workflow, skill, mcpserver, environment, context, ref, metadata, gen)
- **internal/** = Private implementation details
- **examples/** and **docs/** = Learning resources

