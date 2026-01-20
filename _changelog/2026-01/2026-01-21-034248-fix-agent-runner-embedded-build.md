# Fix: Agent Runner Embedded Binary Build Process

**Date**: 2026-01-21  
**Type**: Build System Fix  
**Impact**: Critical - Unblocks local CLI releases

## Problem

The `make release-local` command was failing with:

```
embedded/embedded.go:39:12: pattern binaries/darwin_arm64/agent-runner.tar.gz: no matching files found
```

Two issues were identified:

1. **Missing Docker Image Export**: The build process created the agent-runner Docker image but never exported it as a `.tar.gz` file that the embedded Go code expected.

2. **Cross-Platform Embedding**: The `embedded.go` file attempted to embed binaries for all three supported platforms (darwin_arm64, darwin_amd64, linux_amd64) during local builds, but only the current platform's binaries were built.

## Solution

### 1. Added Docker Image Export Step

Created a new `export-image-tarball` target in `backend/services/agent-runner/Makefile`:

```makefile
.PHONY: export-image-tarball
export-image-tarball: build-image
	@echo "📦 Exporting Docker image as tarball..."
	$(CONTAINER_RUNTIME) save $(IMAGE_REPO):$(VERSION) | gzip > $(REPO_ROOT)/client-apps/cli/embedded/binaries/darwin_arm64/agent-runner.tar.gz
	@cp $(REPO_ROOT)/client-apps/cli/embedded/binaries/darwin_arm64/agent-runner.tar.gz $(REPO_ROOT)/client-apps/cli/embedded/binaries/darwin_amd64/agent-runner.tar.gz
	@cp $(REPO_ROOT)/client-apps/cli/embedded/binaries/darwin_arm64/agent-runner.tar.gz $(REPO_ROOT)/client-apps/cli/embedded/binaries/linux_amd64/agent-runner.tar.gz
	@echo "✅ Exported tarballs to all platform directories"
```

This target:
- Exports the Docker image using `docker save`
- Compresses it with gzip
- Copies it to all three platform directories (the Docker image is platform-independent)

### 2. Platform-Specific Embedded Files

Refactored the embedding architecture to use Go build tags:

**Created three platform-specific files:**

- `embedded/embedded_darwin_arm64.go` (with `//go:build darwin && arm64`)
- `embedded/embedded_darwin_amd64.go` (with `//go:build darwin && amd64`)
- `embedded/embedded_linux_amd64.go` (with `//go:build linux && amd64`)

Each file embeds only the binaries for its platform and provides the same interface:
- `GetStigmerServerBinary() ([]byte, error)`
- `GetWorkflowRunnerBinary() ([]byte, error)`
- `GetAgentRunnerTarball() ([]byte, error)`

**Simplified `embedded/embedded.go`:**

Removed all `//go:embed` directives and kept only the platform detection logic (`Platform`, `CurrentPlatform()`, `IsSupported()`).

### 3. Updated Build Targets

Modified `client-apps/cli/Makefile` to call the new export target:

```makefile
.PHONY: build-agent-runner-image
build-agent-runner-image:
	@echo "🐳 Building agent-runner Docker image..."
	@$(MAKE) -C $(REPO_ROOT)/backend/services/agent-runner export-image-tarball VERSION=$(AGENT_RUNNER_IMAGE_TAG)
	@echo "✓ Built: ghcr.io/stigmer/agent-runner:$(AGENT_RUNNER_IMAGE_TAG)"
```

## Benefits

1. **Local Development Works**: `make release-local` now completes successfully, building only the current platform's binaries.

2. **Platform Independence**: The agent-runner Docker image is built once and copied to all platform directories, since Docker images are platform-independent.

3. **Build Efficiency**: Go's build tags ensure only the relevant platform's binaries are embedded at compile time, reducing memory usage and binary size.

4. **Production Ready**: The architecture supports building for all platforms in CI/CD by cross-compiling Go binaries before running the build.

## Files Changed

**Modified:**
- `backend/services/agent-runner/Makefile` - Added `export-image-tarball` target
- `client-apps/cli/Makefile` - Updated to call new export target
- `client-apps/cli/embedded/embedded.go` - Removed embed directives, kept platform utils

**Created:**
- `client-apps/cli/embedded/embedded_darwin_arm64.go` - macOS Apple Silicon embeddings
- `client-apps/cli/embedded/embedded_darwin_amd64.go` - macOS Intel embeddings
- `client-apps/cli/embedded/embedded_linux_amd64.go` - Linux AMD64 embeddings

## Testing

Verified successful build:

```bash
$ make release-local
============================================
Building and Installing Stigmer Locally
============================================

Step 1: Cleaning old binaries...
✓ Old binaries removed

Step 2: Building embedded binaries and Docker image...
📦 Building stigmer-server for darwin_arm64...
✓ Embedded: embedded/binaries/darwin_arm64/stigmer-server
📦 Building workflow-runner for darwin_arm64...
✓ Embedded: embedded/binaries/darwin_arm64/workflow-runner
🐳 Building agent-runner Docker image...
✅ Built: ghcr.io/stigmer/agent-runner:dev-local
📦 Exporting Docker image as tarball...
✅ Exported tarballs to all platform directories

============================================
✓ All Binaries Ready for darwin_arm64
============================================
-rw-r--r--@ 1 suresh  staff   456M Jan 21 03:42 agent-runner.tar.gz
-rwxr-xr-x@ 1 suresh  staff    40M Jan 21 03:41 stigmer-server
-rwxr-xr-x@ 1 suresh  staff    61M Jan 21 03:41 workflow-runner

🔨 Building CLI with embedded binaries...
✓ CLI built: bin/stigmer (with embedded binaries for darwin_arm64)

Step 3: Installing to ~/bin...
✓ Installed: /Users/suresh/bin/stigmer

============================================
✓ Release Complete!
============================================

$ stigmer --help
Stigmer is an open-source agentic automation platform.
[... help output ...]
```

## Architecture Notes

### Why Platform-Specific Files?

Using Go build tags (`//go:build`) instead of runtime switches provides:

1. **Compile-Time Safety**: Missing binaries are caught during build, not at runtime
2. **Smaller Binaries**: Only current platform's binaries are embedded (not all 3)
3. **Simpler Code**: No complex switch statements in the getter functions
4. **Better Performance**: No runtime checks for platform detection

### Why Copy Docker Image to All Platforms?

The agent-runner Docker image is Linux-based and runs the same way on all host platforms (via Docker Desktop on macOS, native on Linux). The host platform only determines where the Docker daemon runs, not the image contents.

For local development, we only build the Linux/amd64 image once and copy it to all platform directories to satisfy Go's embed requirements. In production CI/CD, we'd build multi-arch images separately.

## Future Improvements

1. **CI/CD Cross-Compilation**: Add GitHub Actions workflow to build all platforms
2. **Image Size Optimization**: Explore Nuitka compilation to reduce 456MB tarball size
3. **Multi-Arch Images**: Build linux/arm64 variant for Apple Silicon containers
4. **Lazy Loading**: Load agent-runner tarball on-demand instead of embedding in binary

## Related Issues

- Fixes the critical blocker preventing local CLI releases
- Enables developer onboarding with `make release-local`
- Unblocks testing of embedded server functionality
