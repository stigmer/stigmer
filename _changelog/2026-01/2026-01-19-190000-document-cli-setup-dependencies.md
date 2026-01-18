# Document CLI Setup, Dependencies, and Current Commands

**Date**: 2026-01-19  
**Type**: Documentation  
**Scope**: README, CLI Makefile, CLI Commands  
**Impact**: User onboarding, developer experience

## Summary

Added comprehensive documentation for Stigmer OSS CLI setup, dependencies, configuration, and current command implementation status. Fixed incorrect SQLite references (should be BadgerDB) and created clear distinction between implemented vs planned features.

## Changes Made

### 1. README.md - Prerequisites and Dependencies

**Added Prerequisites Section**:
- Anthropic API Key requirement (with link to console)
- Temporal Server setup (optional for basic CLI, required for agent execution)
- Build dependencies (Go 1.21+, Python 3.11+ with Poetry)
- Docker commands for installing Temporal locally

**Added Configuration Documentation**:
- Three ways to configure daemon: Interactive, Environment Variables, Command-line Flags
- Configuration priority: Flags → Env Vars → Keychain → Defaults → Prompt
- Environment variables table with descriptions
- Examples for different setups (minimal, full, production-like)

**Fixed Storage References**:
- ❌ Incorrect: "SQLite database in `~/.stigmer/stigmer.db`"
- ✅ Correct: "BadgerDB key-value store in `~/.stigmer/data/`"
- Updated all architecture diagrams to show BadgerDB
- Updated storage strategy section with key-value pattern details
- Fixed component descriptions

**Updated Quick Start**:
- Removed non-existent `curl -sSL https://stigmer.ai/install.sh | bash` command
- Changed to `make install` and `make release-local` from source
- Clarified what `stigmer init` actually does (not template scaffolding)
- Marked `stigmer apply` and `stigmer run` as "not yet implemented"
- Marked `stigmer agent execute` as "coming soon"

**Added Local Development Stack Diagram**:
- Visual 4-layer architecture
- Clear separation: CLI → stigmer-server → Temporal → agent-runner
- Minimal setup vs Full setup examples

**Enhanced Troubleshooting**:
- Daemon won't start
- Agent execution fails (Temporal connection)
- Missing Anthropic API key (multiple ways to set)
- Database locked errors
- Connect to custom Temporal server

### 2. client-apps/cli/Makefile - Build Automation

**Added Comprehensive Makefile** similar to stigmer-cloud pattern:

```makefile
make help          # Show all commands + what's implemented
make build         # Build CLI with Bazel
make install       # Build and install to GOPATH/bin
make release-local # Clean, build, install, verify (recommended for testing)
make run           # Run CLI with ARGS="..."
make test          # Run tests
make clean         # Clean artifacts
```

**Key Features**:
- Installs to `GOPATH/bin` for global availability
- `release-local` target mimics stigmer-cloud's workflow
- Verification step ensures CLI works after install
- Inline documentation of all implemented CLI commands
- Distinction between implemented vs planned commands

### 3. client-apps/cli/COMMANDS.md - Command Reference

**Created comprehensive command documentation**:

**Currently Implemented**:
- Init & daemon management (`stigmer init`, `stigmer local start/stop/status/restart`)
- Backend configuration (`stigmer backend status/set`)
- Agent management via CLI flags (`stigmer agent create/list/get/delete`)
- Workflow management via CLI flags (`stigmer workflow create/list/get/delete`)
- Version (`stigmer version`)

**Not Yet Implemented** (planned):
- YAML-based resource management (`stigmer apply -f file.yaml`)
- Execution commands (`stigmer agent execute`, `stigmer workflow execute`)
- Auto-discovery (`stigmer run`)
- Templates and scaffolding (`stigmer init --template`)
- Resource export/import

**Configuration Documentation**:
- Environment variables table
- Command-line flags for `stigmer local start`
- Example configurations
- Migration path (Phase 1 → Phase 2 → Phase 3)

## Why These Changes

### 1. Prerequisites Were Missing

Users had no idea what dependencies were needed:
- Anthropic API key (required for AI)
- Temporal (required for execution, optional for CRUD)
- Build tools (Go, Python, Poetry)

This caused confusion and setup failures.

### 2. BadgerDB vs SQLite Confusion

The code uses **BadgerDB** but README incorrectly said SQLite:
- BadgerDB is the actual implementation (per ADR)
- Pure Go, no CGO dependencies
- 10-50x faster for Protobuf storage
- Chosen specifically for daemon architecture

Fixed all references to be consistent.

### 3. Incorrect Install Instructions

README showed `curl -sSL https://stigmer.ai/install.sh | bash` but:
- This script doesn't exist
- No pre-built binaries available yet
- Users must build from source

Updated to use `make install` and `make release-local`.

### 4. Unclear What's Implemented

Users trying examples from README would hit "command not found" errors:
- `stigmer apply` - not implemented yet
- `stigmer run` - not implemented yet  
- `stigmer agent execute` - not implemented yet

Created clear separation between current vs future functionality.

### 5. No Build/Test Workflow

Developers had no easy way to:
- Build and install CLI locally
- Test changes
- Verify installation worked

Added `make release-local` for complete build/install/verify workflow.

### 6. Missing Configuration Documentation

Users didn't know:
- How to pass Anthropic API key (env var, flag, or prompt)
- How to configure Temporal address
- What the defaults were
- Priority order of configuration sources

Added comprehensive configuration documentation with examples.

## Configuration Examples Added

**Minimal Setup** (create/list agents only):
```bash
stigmer init
stigmer local start  # Prompts for API key
```

**Automated Setup** (no prompts):
```bash
export ANTHROPIC_API_KEY=sk-ant-...
stigmer local start
```

**Custom Temporal**:
```bash
stigmer local start --temporal-host=192.168.1.5:7233
```

**Production-like**:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
export TEMPORAL_HOST=temporal.company.internal:7233
export TEMPORAL_NAMESPACE=production
stigmer local start
```

## Files Changed

```
README.md                      - Updated prerequisites, Quick Start, architecture diagrams
client-apps/cli/Makefile       - Added install/release-local targets + documentation
client-apps/cli/COMMANDS.md    - Created (new) - Complete command reference
```

## Impact

**User Onboarding**:
- ✅ Clear prerequisites before starting
- ✅ Working install instructions  
- ✅ Configuration examples for different scenarios
- ✅ Troubleshooting guide

**Developer Experience**:
- ✅ Easy build/install workflow (`make release-local`)
- ✅ Clear understanding of what's implemented
- ✅ Test commands before committing to implementation

**Documentation Accuracy**:
- ✅ BadgerDB correctly documented (not SQLite)
- ✅ No false promises about features not yet implemented
- ✅ Realistic expectations set

## Next Steps

This documentation work sets the foundation for:

1. **Actual Implementation**: Developers can now see what's missing and implement it
2. **User Testing**: Users can successfully set up and test current functionality  
3. **Future Features**: Clear roadmap of what needs to be built (apply, run, execute)

When `stigmer apply` and `stigmer run` are implemented, the documentation structure is already in place to update.

## Testing

To verify:
```bash
cd client-apps/cli
make release-local

# Should successfully:
# - Build CLI
# - Install to GOPATH/bin
# - Verify stigmer --help works

stigmer --help  # Should show all commands
stigmer init    # Should initialize backend
```

## Related

- ADR: [Local Backend to Use BadgerDB](docs/adr/20260118-181912-local-backend-to-use-badgerdb.md)
- Getting Started: [Local Mode](docs/getting-started/local-mode.md)
- Architecture: [Temporal Integration](docs/architecture/temporal-integration.md)
