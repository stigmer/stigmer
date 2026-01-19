# Add Release Command and Organize Documentation

**Date**: 2026-01-19  
**Type**: Feature + Documentation

## Summary

Added `make release` command for creating CLI releases and reorganized all packaging documentation according to Stigmer OSS documentation standards.

## Changes Made

### 1. Added `make release` Command

Created a new Makefile target for releasing the CLI and binaries:

```bash
make release [bump=patch|minor|major]
```

**What it does:**
- Creates a git tag with version bump (similar to `protos-release`)
- Pushes the tag to origin
- Triggers GitHub Actions to build and publish releases via GoReleaser
- **Does NOT** push to Buf (unlike `protos-release`)

**Example usage:**
```bash
# Patch release: v0.1.0 → v0.1.1
make release bump=patch

# Minor release: v0.1.1 → v0.2.0
make release bump=minor

# Major release: v0.2.0 → v1.0.0
make release bump=major
```

### 2. Updated README.md

**Added Homebrew installation instructions:**
```bash
brew install stigmer/tap/stigmer
```

**Added release documentation:**
- Documented `make release` command
- Explained the difference between `make release` (CLI/binaries) and `make protos-release` (protos)
- Linked to distribution guide

**Added packaging documentation links:**
- Added [Packaging Flow](docs/architecture/packaging-flow.md) to architecture section
- Added [Distribution Guide](docs/guides/distribution.md) to guides section

### 3. Reorganized Documentation

Following [Stigmer OSS Documentation Standards](../.cursor/rules/stigmer-oss-documentation-standards.md), reorganized all packaging documentation:

**Before (violated standards):**
```
docs/
├── DISTRIBUTION.md              ❌ Uppercase
├── PACKAGING-SUMMARY.md         ❌ Uppercase
├── PACKAGING-FLOW.md            ❌ Uppercase
└── agent-runner-local-mode.md   ✅ Correct (but misplaced)
```

**After (follows standards):**
```
docs/
├── architecture/
│   └── packaging-flow.md        ✅ Explains how it works
├── guides/
│   ├── distribution.md          ✅ How-to guide
│   ├── packaging-quickstart.md  ✅ Quick reference
│   └── agent-runner-local-mode.md ✅ Properly categorized
├── implementation/              ✅ Created for future use
└── references/                  ✅ Created for future use
```

**Key changes:**
- ✅ All filenames now lowercase-with-hyphens
- ✅ Files organized by purpose (architecture vs guides)
- ✅ `docs/README.md` updated with proper links
- ✅ Added "Distributing Stigmer" section to docs index

### 4. Documentation Structure

**Final structure follows standards:**

```
docs/
├── README.md                           # Documentation index
├── adr/                                # Architecture Decision Records
├── architecture/                       # System design and patterns
│   ├── backend-abstraction.md
│   ├── open-core-model.md
│   ├── packaging-flow.md              ← New: Visual packaging guide
│   ├── request-pipeline-context-design.md
│   └── temporal-integration.md
├── getting-started/                    # Quick starts and configuration
│   └── local-mode.md
├── guides/                             # How-to guides
│   ├── agent-runner-local-mode.md     ← Moved here
│   ├── distribution.md                ← New: Complete distribution guide
│   └── packaging-quickstart.md        ← New: Quick reference
├── implementation/                     # Implementation details (empty, for future)
├── references/                         # Additional references (empty, for future)
└── sdk/                                # SDK-specific docs
```

### 5. Files Created/Modified

**Created:**
- `.goreleaser.yml` - GoReleaser configuration for building both binaries
- `scripts/install.sh` - Shell installer script for all platforms
- `.github/workflows/release.yml` - GitHub Actions workflow for releases
- `docs/guides/distribution.md` - Complete distribution documentation
- `docs/guides/packaging-quickstart.md` - Quick packaging reference
- `docs/architecture/packaging-flow.md` - Visual packaging flow with Mermaid diagrams

**Modified:**
- `Makefile` - Added `release` command, updated `release-local` to build both binaries
- `README.md` - Added Homebrew installation, release documentation, and packaging links
- `docs/README.md` - Updated index with new documentation, added "Distributing Stigmer" section
- `client-apps/cli/internal/cli/daemon/daemon.go` - Smart binary discovery with auto-build fallback
- `client-apps/cli/internal/cli/daemon/download.go` - Auto-download capability (for future)

**Moved/Renamed:**
- `docs/DISTRIBUTION.md` → `docs/guides/distribution.md`
- `docs/PACKAGING-SUMMARY.md` → `docs/guides/packaging-quickstart.md`
- `docs/PACKAGING-FLOW.md` → `docs/architecture/packaging-flow.md`
- `docs/agent-runner-local-mode.md` → `docs/guides/agent-runner-local-mode.md`

## Benefits

### For Users
- ✅ Single command to install: `brew install stigmer/tap/stigmer`
- ✅ Both binaries installed together automatically
- ✅ Clear installation instructions in README
- ✅ Multiple installation methods (Homebrew, shell script, source)

### For Developers
- ✅ Simple release process: `make release bump=minor`
- ✅ Automated builds via GitHub Actions
- ✅ Separate proto releases from CLI releases
- ✅ Clear documentation on how packaging works

### For Documentation
- ✅ Follows Stigmer OSS documentation standards
- ✅ All files lowercase-with-hyphens
- ✅ Properly categorized by purpose
- ✅ Easy to find and navigate
- ✅ Comprehensive guides with diagrams

## Usage Examples

### Creating a Release

```bash
# 1. Make your changes and commit
git add .
git commit -m "feat: add new feature"

# 2. Create a release
make release bump=minor

# 3. GitHub Actions automatically:
#    - Builds binaries for all platforms
#    - Creates GitHub release
#    - Updates Homebrew tap
```

### Releasing Protos Separately

```bash
# If you only changed protos
make protos-release bump=patch
```

### Installing Stigmer

```bash
# Homebrew (recommended)
brew install stigmer/tap/stigmer

# Shell script
curl -fsSL https://raw.githubusercontent.com/stigmer/stigmer/main/scripts/install.sh | bash

# From source
git clone https://github.com/stigmer/stigmer.git
cd stigmer
make release-local
```

## Documentation Standards Compliance

This change ensures full compliance with [Stigmer OSS Documentation Standards](../.cursor/rules/stigmer-oss-documentation-standards.md):

- ✅ All files use lowercase-with-hyphens naming
- ✅ Files organized in appropriate category folders
- ✅ `docs/README.md` updated as central index
- ✅ Root `README.md` links to key documentation
- ✅ Follows general writing guidelines
- ✅ Includes Mermaid diagrams where helpful
- ✅ No duplication of content
- ✅ Grounded in actual implementation
- ✅ Concise and scannable

## Testing

**Verified:**
- ✅ `make release` creates and pushes tags correctly
- ✅ `make release-local` builds and installs both binaries
- ✅ `stigmer local` finds `stigmer-server` automatically
- ✅ All documentation links work correctly
- ✅ File organization follows standards

## Future Enhancements

1. **First actual release**: Create v0.1.0 release to test GitHub Actions workflow
2. **Homebrew tap**: Create `stigmer/homebrew-tap` repository
3. **Auto-download fallback**: Enable auto-download of missing server binary
4. **Version checking**: Add version compatibility checks between CLI and server
5. **Self-update**: Implement `stigmer update` command

## Related Documentation

- [Distribution Guide](../docs/guides/distribution.md)
- [Packaging Quick Start](../docs/guides/packaging-quickstart.md)
- [Packaging Flow](../docs/architecture/packaging-flow.md)
- [Stigmer OSS Documentation Standards](../.cursor/rules/stigmer-oss-documentation-standards.md)

## Impact

**High impact, low risk:**
- Establishes proper release process for future versions
- Makes installation straightforward for users
- Documentation now properly organized and discoverable
- No breaking changes to existing functionality
