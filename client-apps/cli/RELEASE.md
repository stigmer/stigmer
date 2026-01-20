# Stigmer CLI Release Process

This document describes how Stigmer CLI releases work with embedded binaries.

## Overview

The Stigmer CLI embeds all required binaries at compile time:
- `stigmer-server` (Go binary)
- `workflow-runner` (Go binary)  
- `agent-runner` (Python code as tar.gz)

Users download a single platform-specific binary (~123 MB) that contains everything needed to run Stigmer locally.

## Release Workflow

### Automated Releases (Recommended)

1. **Create a Git tag**:
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```

2. **GitHub Actions automatically**:
   - Builds binaries for 3 platforms (darwin-arm64, darwin-amd64, linux-amd64)
   - Embeds backend binaries into each CLI binary
   - Creates GitHub Release with platform-specific downloads
   - Updates Homebrew tap with new version

3. **Users install via**:
   ```bash
   # Homebrew (automatically gets correct platform)
   brew install stigmer/tap/stigmer
   
   # Or direct download from GitHub Releases
   ```

### Platform-Specific Builds

The workflow uses native runners for each platform:

| Platform | Runner | Output |
|----------|--------|--------|
| **macOS Apple Silicon** | `macos-latest` (M1) | `stigmer-v1.0.0-darwin-arm64.tar.gz` |
| **macOS Intel** | `macos-13` (Intel) | `stigmer-v1.0.0-darwin-amd64.tar.gz` |
| **Linux x86-64** | `ubuntu-latest` | `stigmer-v1.0.0-linux-amd64.tar.gz` |

Each build:
1. Runs `make embed-binaries` (builds stigmer-server, workflow-runner, agent-runner for that platform)
2. Runs `go build` for CLI (embeds the platform-specific binaries)
3. Packages the result as `.tar.gz` with SHA256 checksum

## Local Development

### Building Locally

```bash
# Build for your current platform
make release-local

# This will:
# 1. Build stigmer-server, workflow-runner, agent-runner
# 2. Copy them to client-apps/cli/embedded/binaries/{platform}/
# 3. Build CLI with embedded binaries
# 4. Install to ~/bin/stigmer
```

### Testing Before Release

```bash
# Clean state test
rm -rf ~/.stigmer
stigmer server

# Verify extraction
ls -lh ~/.stigmer/data/bin/
# Should show: stigmer-server, workflow-runner, agent-runner/
```

## What Gets Committed to Git?

**✅ Commit:**
- Code changes
- Makefile targets
- GitHub Actions workflows
- Documentation

**❌ Don't Commit:**
- Binaries in `client-apps/cli/embedded/binaries/` (gitignored)
- Build artifacts in `bin/`

Binaries are built on-demand:
- Locally: via `make embed-binaries`
- CI/CD: via GitHub Actions runners

## Homebrew Distribution

After release, the Homebrew formula is automatically updated in `stigmer/homebrew-tap`:

```ruby
class Stigmer < Formula
  desc "AI-powered workflow automation with local LLMs"
  homepage "https://github.com/stigmer/stigmer"
  version "1.0.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/.../stigmer-v1.0.0-darwin-arm64.tar.gz"
      sha256 "..."
    else
      url "https://github.com/.../stigmer-v1.0.0-darwin-amd64.tar.gz"
      sha256 "..."
    end
  end

  on_linux do
    url "https://github.com/.../stigmer-v1.0.0-linux-amd64.tar.gz"
    sha256 "..."
  end

  def install
    bin.install "stigmer"
  end
end
```

Users get the correct binary for their platform automatically.

## Release Checklist

- [ ] All tests passing (`make test`)
- [ ] Version updated in code (if needed)
- [ ] Changelog updated (optional)
- [ ] Create and push Git tag: `git tag v1.0.0 && git push origin v1.0.0`
- [ ] Wait for GitHub Actions to complete (~15-20 minutes)
- [ ] Verify releases created on GitHub
- [ ] Test installation: `brew install stigmer/tap/stigmer` (or `brew upgrade`)
- [ ] Smoke test: `stigmer server` on fresh install

## Troubleshooting

### Build fails with "binary not found"

Make sure `make embed-binaries` runs before `go build`. Check the workflow file.

### Wrong platform binary embedded

Platform detection happens automatically via `uname`. Check runner OS in GitHub Actions logs.

### Homebrew formula not updated

Check the `update-homebrew` job in GitHub Actions. May need `GITHUB_TOKEN` with repo write permissions.

## Version Schema

Stigmer uses semantic versioning:
- `v1.0.0` - Major release (breaking changes)
- `v1.1.0` - Minor release (new features)
- `v1.1.1` - Patch release (bug fixes)

The CLI embeds a version marker that's written to `~/.stigmer/data/bin/.version` during extraction. If versions mismatch, binaries are re-extracted automatically.

## Future Enhancements

- [ ] Add Windows support (darwin/linux only for now)
- [ ] Add ARM Linux support (arm64)
- [ ] Add binary compression (UPX) to reduce size
- [ ] Add checksums verification during extraction
- [ ] Cache builds across workflow jobs (if build time becomes an issue)
