# Documentation Reorganization

**Date**: 2026-01-13  
**Purpose**: Align stigmer-sdk repository with Stigmer project documentation standards

---

## Summary

Reorganized all documentation in the stigmer-sdk repository to follow the Stigmer project's documentation standards:

- ✅ **Lowercase with hyphens**: All files renamed from UPPERCASE to lowercase-with-hyphens
- ✅ **Organized in `docs/` folders**: Documentation moved to proper category folders
- ✅ **Documentation indices**: Created README.md files for navigation
- ✅ **Consistent structure**: Matches Stigmer monorepo conventions

---

## Changes Made

### File Renames (UPPERCASE → lowercase-with-hyphens)

| Old Location | New Location | Type |
|--------------|--------------|------|
| `go/BUF_DEPENDENCY_GUIDE.md` | `go/docs/guides/buf-dependency-guide.md` | Guide |
| `go/MIGRATION.md` | `go/docs/guides/migration-guide.md` | Guide |
| `go/PROTO_MAPPING.md` | `go/docs/references/proto-mapping.md` | Reference |
| `MIGRATION_TO_BUF_COMPLETE.md` | `docs/implementation/buf-migration-complete.md` | Implementation Report |
| `go/examples/TASK3_MANIFEST_EXAMPLE.go` | `go/examples/task3-manifest-example.go` | Example Code |
| `python/IMPLEMENTATION_STATUS.md` | `python/docs/implementation/status.md` | Implementation Report |

### New Documentation Indices Created

1. **`docs/README.md`** - Root SDK documentation index (multi-language)
2. **`go/docs/README.md`** - Go SDK documentation index
3. **`python/docs/README.md`** - Python SDK documentation index

### Updated References

Updated all internal links in the following files:
- `go/README.md` - Updated to point to new documentation paths
- `docs/implementation/buf-migration-complete.md` - Updated all file references

---

## New Documentation Structure

```
stigmer-sdk/
├── docs/                                # Root SDK documentation
│   ├── README.md                        # Multi-language SDK index
│   ├── implementation/                  # Implementation reports
│   │   ├── buf-migration-complete.md
│   │   └── documentation-reorganization.md (this file)
│   ├── guides/                          # (Future guides)
│   └── references/                      # (Future references)
│
├── go/                                  # Go SDK
│   ├── docs/                            # Go-specific documentation
│   │   ├── README.md                    # Go SDK documentation index
│   │   ├── guides/                      # How-to guides
│   │   │   ├── buf-dependency-guide.md
│   │   │   └── migration-guide.md
│   │   ├── implementation/              # (Future implementation reports)
│   │   └── references/                  # Reference documentation
│   │       └── proto-mapping.md
│   ├── examples/                        # Code examples
│   │   ├── 01_basic_agent.go
│   │   ├── 02_agent_with_skills.go
│   │   ├── 03_agent_with_mcp_servers.go
│   │   ├── 04_agent_with_subagents.go
│   │   ├── 05_agent_with_environment_variables.go
│   │   ├── 06_agent_with_instructions_from_files.go
│   │   └── task3-manifest-example.go    # Task 3 reference
│   └── README.md                        # Go SDK main README
│
└── python/                              # Python SDK
    ├── docs/                            # Python-specific documentation
    │   ├── README.md                    # Python SDK documentation index
    │   └── implementation/              # Implementation reports
    │       └── status.md
    └── README.md                        # Python SDK main README
```

---

## Documentation Standards Applied

### File Naming Convention

**Rule**: All documentation files use lowercase with hyphens

✅ **Correct Examples**:
- `buf-dependency-guide.md`
- `migration-guide.md`
- `proto-mapping.md`
- `task3-manifest-example.go`

❌ **Incorrect Examples** (old style):
- `BUF_DEPENDENCY_GUIDE.md` (UPPERCASE)
- `MIGRATION.md` (UPPERCASE)
- `TASK3_MANIFEST_EXAMPLE.go` (UPPERCASE with underscores)

### Organization Principle

All documentation (except root README.md) lives in a `docs/` folder, organized by purpose:

- **`docs/guides/`** - How-to guides and tutorials
- **`docs/implementation/`** - Implementation reports and status
- **`docs/references/`** - Reference documentation and API mappings
- **`docs/architecture/`** - System design and patterns (future)
- **`docs/getting-started/`** - Quick starts and configuration (future)

### Documentation Indices

Each `docs/` folder has a `README.md` that serves as a complete index:

- Lists all documentation in that scope
- Provides navigation links
- Groups documents by category
- Links to related documentation

---

## Verification

### All Tests Pass ✅

```bash
$ cd go && go test ./...
?   	github.com/leftbin/stigmer-sdk/go	[no test files]
ok  	github.com/leftbin/stigmer-sdk/go/agent	(cached)
ok  	github.com/leftbin/stigmer-sdk/go/environment	(cached)
?   	github.com/leftbin/stigmer-sdk/go/examples	[no test files]
ok  	github.com/leftbin/stigmer-sdk/go/mcpserver	(cached)
ok  	github.com/leftbin/stigmer-sdk/go/skill	(cached)
ok  	github.com/leftbin/stigmer-sdk/go/subagent	(cached)
```

### Example Builds Successfully ✅

```bash
$ go build ./go/examples/task3-manifest-example.go
# Success - no errors
```

### Documentation Structure ✅

```
docs/
├── README.md
├── guides/
├── implementation/
│   ├── buf-migration-complete.md
│   └── documentation-reorganization.md
└── references/

go/docs/
├── README.md
├── guides/
│   ├── buf-dependency-guide.md
│   └── migration-guide.md
├── implementation/
└── references/
    └── proto-mapping.md

python/docs/
├── README.md
└── implementation/
    └── status.md
```

---

## Benefits

### Consistency
- ✅ Matches Stigmer monorepo conventions
- ✅ Consistent with other Stigmer projects
- ✅ Easy to navigate and find documentation

### Scalability
- ✅ Clear categories prevent root directory clutter
- ✅ Easy to add new documentation
- ✅ Documentation indices keep everything organized

### Developer Experience
- ✅ Follows open-source conventions
- ✅ Lowercase filenames work across all platforms (Windows, macOS, Linux)
- ✅ Clear separation of concerns (guides vs references vs implementation)

---

## References

- **Stigmer Documentation Standards**: See `@documentation-standards.md` in Stigmer monorepo
- **Example**: `backend/services/workflow-runner/docs/` in Stigmer monorepo
- **Writing Guidelines**: See workspace rule `@general-writing-guidelines.mdc`

---

**Status**: ✅ Reorganization Complete

All documentation now follows Stigmer project standards with lowercase-with-hyphens naming and organized `docs/` folder structure.
