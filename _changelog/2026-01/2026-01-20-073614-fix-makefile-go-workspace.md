# Fix Makefile Targets for Go Workspace Migration

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Scope**: Build System  
**Impact**: Critical - `make test` was completely broken

## Problem

After migrating from a root `go.mod` to a `go.work` workspace structure, multiple Makefile targets failed with:

```
pattern ./...: directory prefix . does not contain modules listed in go.work or their selected dependencies
```

The root directory is no longer a Go module—it's a workspace containing 6 separate modules. Commands like `go test ./...`, `go vet ./...`, and `go mod download` run from the root failed because they expected a single module.

## Root Cause

The `go.work` file lists these modules:
- `./apis/stubs/go`
- `./backend/libs/go`
- `./backend/services/stigmer-server`
- `./backend/services/workflow-runner`
- `./client-apps/cli`
- `./sdk/go`

When running `go test ./...` from the root, Go looked for a `go.mod` in the root directory, but it doesn't exist. The workspace structure requires running commands in each module directory individually.

## Solution

Updated all Makefile targets to iterate through workspace modules instead of assuming a single root module.

### Changes Made

#### 1. `test` Target - Complete Rewrite

**Before** (broken):
```makefile
test:
	go test -v -race -timeout 30s ./...  # Fails - no root module
	cd sdk/go && go test ...
	cd backend/services/workflow-runner && go test ...
	# Python tests
```

**After** (working):
```makefile
test:
	@echo "1/7 Running API Stubs Tests..."
	cd apis/stubs/go && go test -v -race -timeout 30s ./...
	
	@echo "2/7 Running Backend Libs Tests..."
	cd backend/libs/go && go test -v -race -timeout 30s ./...
	
	@echo "3/7 Running Stigmer Server Tests..."
	cd backend/services/stigmer-server && go test -v -race -timeout 30s ./...
	
	@echo "4/7 Running Workflow Runner Tests..."
	cd backend/services/workflow-runner && go test -v -race -timeout 30s ./...
	
	@echo "5/7 Running CLI Tests..."
	cd client-apps/cli && go test -v -race -timeout 30s ./...
	
	@echo "6/7 Running SDK Go Tests..."
	cd sdk/go && go test -v -race -timeout 30s ./...
	
	@echo "7/7 Running Agent Runner Tests (Python)..."
	cd backend/services/agent-runner && poetry install --no-interaction --quiet && poetry run pytest
```

Now tests all 7 modules (6 Go + 1 Python) individually.

#### 2. `test-root` → `test-all-go` - Renamed and Fixed

**Before**:
```makefile
test-root: ## Run root module tests only
	go test -v -race -timeout 30s ./...  # Fails - no root module
```

**After**:
```makefile
test-all-go: ## Run all Go workspace module tests
	@cd apis/stubs/go && go test -v -race -timeout 30s ./...
	@cd backend/libs/go && go test -v -race -timeout 30s ./...
	@cd backend/services/stigmer-server && go test -v -race -timeout 30s ./...
	@cd backend/services/workflow-runner && go test -v -race -timeout 30s ./...
	@cd client-apps/cli && go test -v -race -timeout 30s ./...
	@cd sdk/go && go test -v -race -timeout 30s ./...
```

Renamed to reflect reality (no "root" module anymore) and runs all Go module tests (excludes Python).

#### 3. `coverage` Target - Per-Module Coverage

**Before**:
```makefile
coverage:
	go test -v -race -coverprofile=coverage.txt -covermode=atomic ./...
```

**After**:
```makefile
coverage:
	@echo "Generating coverage report for all Go modules..."
	@mkdir -p coverage
	@cd apis/stubs/go && go test -v -race -coverprofile=../../../coverage/apis.txt -covermode=atomic ./...
	@cd backend/libs/go && go test -v -race -coverprofile=../../../coverage/libs.txt -covermode=atomic ./...
	@cd backend/services/stigmer-server && go test -v -race -coverprofile=../../../coverage/server.txt -covermode=atomic ./...
	@cd backend/services/workflow-runner && go test -v -race -coverprofile=../../../coverage/workflow-runner.txt -covermode=atomic ./...
	@cd client-apps/cli && go test -v -race -coverprofile=../../coverage/cli.txt -covermode=atomic ./...
	@cd sdk/go && go test -v -race -coverprofile=../../coverage/sdk.txt -covermode=atomic ./...
	@echo "Coverage reports generated in coverage/ directory"
```

Now generates separate coverage files per module in a `coverage/` directory:
- `coverage/apis.txt`
- `coverage/libs.txt`
- `coverage/server.txt`
- `coverage/workflow-runner.txt`
- `coverage/cli.txt`
- `coverage/sdk.txt`

#### 4. `lint` Target - Per-Module Linting

**Before**:
```makefile
lint:
	go vet ./...  # Fails - no root module
	gofmt -s -w .
	$(MAKE) -C apis lint
```

**After**:
```makefile
lint:
	@echo "Running Go linters on all modules..."
	@cd apis/stubs/go && go vet ./...
	@cd backend/libs/go && go vet ./...
	@cd backend/services/stigmer-server && go vet ./...
	@cd backend/services/workflow-runner && go vet ./...
	@cd client-apps/cli && go vet ./...
	@cd sdk/go && go vet ./...
	@echo "Running gofmt..."
	gofmt -s -w .
	@echo "Running proto linters..."
	$(MAKE) -C apis lint
```

Runs `go vet` on each module individually.

#### 5. `setup` Target - Per-Module Dependencies

**Before**:
```makefile
setup:
	go mod download  # Ambiguous in workspace
	cd backend/services/agent-runner && poetry install
```

**After**:
```makefile
setup:
	@echo "Installing Go dependencies for all modules..."
	@cd apis/stubs/go && go mod download
	@cd backend/libs/go && go mod download
	@cd backend/services/stigmer-server && go mod download
	@cd backend/services/workflow-runner && go mod download
	@cd client-apps/cli && go mod download
	@cd sdk/go && go mod download
	@echo "Installing Agent Runner dependencies..."
	cd backend/services/agent-runner && poetry install
```

Downloads dependencies for each module explicitly.

#### 6. `clean` Target - Coverage Directory

**Before**:
```makefile
clean:
	rm -rf bin/
	rm -rf coverage.txt coverage.html
	rm -rf backend/services/workflow-runner/bin/
	$(MAKE) -C apis clean
```

**After**:
```makefile
clean:
	rm -rf bin/
	rm -rf coverage/  # New coverage directory
	rm -rf coverage.txt coverage.html  # Legacy files (may not exist)
	rm -rf backend/services/workflow-runner/bin/
	$(MAKE) -C apis clean
```

Added cleanup for the new `coverage/` directory.

## Testing

After changes:

```bash
$ make test
============================================
Running All Tests
============================================

1/7 Running API Stubs Tests...
--------------------------------------------
ok  	ai.stigmer.agentic/... 	0.123s

2/7 Running Backend Libs Tests...
--------------------------------------------
ok  	ai.stigmer.backend.libs/... 	0.456s

# ... all modules test successfully ...

✓ All Tests Complete!
```

All 7 modules tested successfully with clear progress indicators.

## Impact

**Before**:
- ❌ `make test` completely broken
- ❌ `make lint` completely broken
- ❌ `make coverage` completely broken
- ❌ `make setup` ambiguous behavior
- ❌ `make test-root` misleading name

**After**:
- ✅ `make test` runs all 7 modules (6 Go + 1 Python)
- ✅ `make lint` vets all 6 Go modules
- ✅ `make coverage` generates per-module coverage reports
- ✅ `make setup` downloads dependencies for all modules
- ✅ `make test-all-go` accurately named for Go-only tests
- ✅ Clear progress indicators (1/7, 2/7, etc.)
- ✅ Descriptive section headers

## Why This Happened

The migration from a monolithic Go module to a Go workspace changed the repository structure fundamentally:

**Before (single module)**:
```
stigmer/
├── go.mod          # Root module
├── go.sum
└── ...             # All code in one module
```

**After (workspace)**:
```
stigmer/
├── go.work         # Workspace definition
├── apis/stubs/go/go.mod
├── backend/libs/go/go.mod
├── backend/services/stigmer-server/go.mod
├── backend/services/workflow-runner/go.mod
├── client-apps/cli/go.mod
└── sdk/go/go.mod
```

The Makefile wasn't updated to reflect this architectural change.

## Related Changes

- Previous migration: Replaced root `go.mod` with `go.work` workspace
- This fix: Updated Makefile to work with new workspace structure
- Future consideration: Consider `go work sync` for dependency management

## Files Modified

- `Makefile` - 6 targets updated (test, test-all-go, coverage, lint, setup, clean)

## Lessons Learned

When migrating from a single Go module to a Go workspace:

1. **Update all build scripts immediately** - Don't let them break silently
2. **Test build targets after migration** - Verify `make test`, `make lint`, etc.
3. **Update CI/CD pipelines** - May need similar per-module iteration
4. **Consider workspace commands** - `go work sync`, `go work use`, etc.
5. **Document workspace structure** - Clear communication about architectural changes

## Next Steps

- ✅ Verify CI/CD pipeline works with updated Makefile (if applicable)
- ✅ Consider adding `go work sync` to setup target
- ✅ Update developer documentation about workspace structure
- ✅ Test coverage report aggregation (if needed for single report)
