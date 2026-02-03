---
name: Project Loader Foundation
overview: Create the Project loader package following the battle-tested Agent/Workflow loader patterns exactly, with protovalidate as single source of truth for schema validation.
todos:
  - id: build-bazel
    content: Create BUILD.bazel with project proto dependency and test target
    status: completed
  - id: loader-go
    content: Create loader.go with protovalidate integration following Agent pattern exactly
    status: completed
  - id: test-helpers
    content: "Create test helpers: createTestFile, minimalValidProjectYAML, fullProjectYAML, minimalValidProjectJSON"
    status: completed
  - id: file-resolution-tests
    content: "Create file resolution tests: ExplicitPath, AnyFileName, FileNotFound, FilePathRequired"
    status: completed
  - id: parsing-tests
    content: "Create parsing tests: ValidYAML, ValidJSON, InvalidYAMLSyntax, UnknownFieldsRejected"
    status: completed
  - id: protovalidate-tests
    content: "Create protovalidate tests: wrong apiVersion, wrong kind, missing metadata/spec, invalid runtime"
    status: completed
  - id: success-tests
    content: "Create success tests: MinimalValidProject, FullProject, AllRuntimes"
    status: completed
  - id: edge-case-tests
    content: "Create edge case tests: EmptyEntryPoint, EmptyDescription, YAMLSpecialCharacters"
    status: completed
  - id: verify-build
    content: Run bazel test to verify all tests pass and build succeeds
    status: completed
isProject: false
---

# Phase 4 Sub-task 2: Project Loader Foundation

## Overview

This sub-task creates the foundational loader for the Project entity - the aggregate root of ADR-005's Dual-Track Interface. The loader follows the **exact patterns** established by Agent and Workflow loaders, ensuring consistency and maintainability across the codebase.

## Architecture Context

The Project loader is a critical foundation piece that:

- Enables `stigmer project info` and `stigmer project validate` commands
- Parses `stigmer.yaml` files (the SDK synthesis entry point)
- Uses protovalidate as single source of truth (no redundant Go validation)
- Supports both YAML and JSON formats for flexibility

## Files to Create

### 1. `client-apps/cli/internal/cli/project/loader.go` (~160 lines)

Follows the Agent loader pattern exactly:

**Structure:**

- Package-level `protovalidate.Validator` initialized in `init()`
- `LoadOptions` struct with `FilePath string` (required)
- `LoadResult` struct with `Project *projectv1.Project` and `SourcePath string`
- `Load(opts *LoadOptions) (*LoadResult, error)` - main entry point
- `resolveFilePath(filePath string) (string, error)` - validates file exists
- `parseContent(content []byte, filePath string) (*projectv1.Project, error)` - YAML/JSON parsing
- `yamlMapToJSON(m map[string]interface{}) ([]byte, error)` - YAML to JSON conversion
- `convertYAMLValue(v interface{}) interface{}` - recursive value conversion

**Key Implementation Details:**

```go
// Package project provides CLI utilities for managing Project resources.
package project

import (
    "buf.build/go/protovalidate"
    projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
    // ... standard imports
)

var validator protovalidate.Validator

func init() {
    var err error
    validator, err = protovalidate.New()
    if err != nil {
        panic(fmt.Sprintf("failed to initialize protovalidate: %v", err))
    }
}
```

**Error Messages:**

- File path required: Include usage hint `stigmer project validate <file>`
- File not found: Include full path for context
- Parse errors: Include file path and underlying error
- Validation errors: Wrap with "project validation failed in %s"

---

### 2. `client-apps/cli/internal/cli/project/loader_test.go` (~400 lines)

**Test Organization** (matching Agent/Workflow patterns):

1. **Test Helpers** (~70 lines)
  - `createTestFile(t, dir, filename, content) string`
  - `minimalValidProjectYAML() string` - minimal valid stigmer.yaml
  - `fullProjectYAML() string` - complete example with all fields
  - `minimalValidProjectJSON() string` - JSON equivalent
2. **File Resolution Tests** (~40 lines)
  - `TestLoad_ExplicitPath` - explicit file path works
  - `TestLoad_AnyFileName` - content-based validation (not filename-based)
  - `TestLoad_FileNotFound` - proper error message
  - `TestLoad_FilePathRequired` - usage hint in error
3. **Parsing Tests** (~50 lines)
  - `TestLoad_ValidYAML` - valid YAML parsing
  - `TestLoad_ValidJSON` - valid JSON parsing
  - `TestLoad_InvalidYAMLSyntax` - malformed YAML error
  - `TestLoad_UnknownFieldsRejected` - strict parsing (DiscardUnknown: false)
4. **Protovalidate Tests** (~80 lines, table-driven)
  - Wrong apiVersion (`wrong/v1` instead of `agentic.stigmer.ai/v1`)
  - Wrong kind (`WrongKind` instead of `Project`)
  - Missing metadata
  - Missing spec
  - Invalid runtime (unspecified = 0)
  - Invalid runtime (undefined enum value)
5. **Success Cases** (~60 lines)
  - `TestLoad_MinimalValidProject` - minimum required fields
  - `TestLoad_FullProject` - all fields populated
  - `TestLoad_AllRuntimes` - go, python, node runtime values
6. **Edge Cases** (~50 lines)
  - `TestLoad_EmptyEntryPoint` - optional field handling
  - `TestLoad_EmptyDescription` - optional field handling
  - `TestLoad_YAMLSpecialCharacters` - special chars in description

**Test Data:**

```yaml
# minimalValidProjectYAML()
apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test-project
spec:
  runtime: go

# fullProjectYAML()
apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: my-super-app
  org: acme-corp
spec:
  runtime: python
  entry_point: main.py
  description: A comprehensive AI platform
```

---

### 3. `client-apps/cli/internal/cli/project/BUILD.bazel` (~30 lines)

```bazel
load("@rules_go//go:def.bzl", "go_library", "go_test")

go_library(
    name = "project",
    srcs = ["loader.go"],
    importpath = "github.com/stigmer/stigmer/client-apps/cli/internal/cli/project",
    visibility = ["//client-apps/cli:__subpackages__"],
    deps = [
        "//apis/stubs/go/ai/stigmer/agentic/project/v1:project",
        "@build_buf_go_protovalidate//:protovalidate",
        "@com_github_pkg_errors//:errors",
        "@in_gopkg_yaml_v3//:yaml_v3",
        "@org_golang_google_protobuf//encoding/protojson",
    ],
)

go_test(
    name = "project_test",
    srcs = ["loader_test.go"],
    embed = [":project"],
    deps = [
        "//apis/stubs/go/ai/stigmer/agentic/project/v1:project",
        "@com_github_stretchr_testify//assert",
        "@com_github_stretchr_testify//require",
    ],
)
```

---

## Proto Validation Rules (Source of Truth)

The loader relies on these protovalidate rules from [api.proto](apis/ai/stigmer/agentic/project/v1/api.proto):


| Field          | Validation Rule                                  |
| -------------- | ------------------------------------------------ |
| `api_version`  | `const = 'agentic.stigmer.ai/v1'`                |
| `kind`         | `const = 'Project'`                              |
| `metadata`     | `required = true`                                |
| `spec`         | `required = true`                                |
| `spec.runtime` | `required = true`, `defined_only`, `not_in: [0]` |


**No Go-side duplication** - protovalidate enforces all rules.

---

## Implementation Order

1. Create `BUILD.bazel` first (establishes dependencies)
2. Create `loader.go` with all functions
3. Create `loader_test.go` with comprehensive tests
4. Run `bazel test //client-apps/cli/internal/cli/project:project_test`
5. Verify all tests pass
6. Run `gofmt` to ensure code formatting

---

## Success Criteria

- All 12+ test cases pass
- File sizes within limits (loader.go ~160 lines, loader_test.go ~400 lines)
- Zero linter errors
- Pattern consistency with Agent/Workflow loaders verified
- Bazel build succeeds
- Error messages are actionable and include file paths

---

## Engineering Standards Compliance

Per [coding-guidelines.mdc](client-apps/cli/.cursor/rules/coding-guidelines.mdc):

- **File sizes**: loader.go < 250 lines, loader_test.go < 500 lines (within limits)
- **Function sizes**: All functions < 50 lines
- **Error handling**: All errors wrapped with `errors.Wrapf()` including context
- **Package organization**: Business logic in `internal/cli/project/`
- **Test isolation**: Uses `t.TempDir()` for test file isolation
- **No business logic duplication**: Protovalidate is single source of truth

---

## Integration with Subsequent Sub-tasks

This loader is the foundation for:

- **T04.3 (Validator)**: Adds cross-field validation (runtime + entry_point consistency)
- **T04.4 (Display)**: Uses loaded Project for table/yaml/json output
- **T04.5 (Detect)**: Uses loader to parse discovered stigmer.yaml files
- **T04.6 (Commands)**: `project info` and `project validate` call this loader

---

## Reference Implementation

The Agent loader at [internal/cli/agent/loader.go](client-apps/cli/internal/cli/agent/loader.go) serves as the reference implementation. The Project loader should be **indistinguishable in structure** - only the proto type and test data differ.