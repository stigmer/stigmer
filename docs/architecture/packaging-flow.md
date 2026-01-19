# Stigmer Packaging & Distribution Flow

## Visual Overview

```mermaid
flowchart TB
    subgraph "Development"
        DEV[Developer runs<br/>make release-local]
        DEV --> BUILD1[Build stigmer CLI]
        DEV --> BUILD2[Build stigmer-server]
        BUILD1 --> INSTALL1[Install to ~/bin/stigmer]
        BUILD2 --> INSTALL2[Install to ~/bin/stigmer-server]
        INSTALL1 --> WORK1[✓ stigmer local works!]
        INSTALL2 --> WORK1
    end

    subgraph "Release Process"
        TAG[git tag v0.1.0<br/>git push origin v0.1.0]
        TAG --> GHA[GitHub Actions<br/>Triggered]
        GHA --> PROTO[Generate Protos]
        PROTO --> GR[GoReleaser]
        GR --> BINCLI[Build stigmer<br/>for all platforms]
        GR --> BINSVR[Build stigmer-server<br/>for all platforms]
        BINCLI --> ARCHIVE[Create Archives<br/>stigmer_0.1.0_OS_ARCH.tar.gz]
        BINSVR --> ARCHIVE
        ARCHIVE --> GHR[Upload to<br/>GitHub Releases]
        ARCHIVE --> BREW[Update<br/>Homebrew Formula]
    end

    subgraph "User Installation - Homebrew"
        USER1[User runs:<br/>brew install stigmer]
        USER1 --> BREWDL[Homebrew downloads<br/>archive from GitHub]
        BREWDL --> BREWEXT[Extract both binaries]
        BREWEXT --> BREWCLI[Install stigmer<br/>to /opt/homebrew/bin/]
        BREWEXT --> BREWSVR[Install stigmer-server<br/>to /opt/homebrew/bin/]
        BREWCLI --> WORK2[✓ stigmer local works!]
        BREWSVR --> WORK2
    end

    subgraph "User Installation - Shell Script"
        USER2[User runs:<br/>curl install.sh | bash]
        USER2 --> DETECT[Detect OS/Arch]
        DETECT --> DLGH[Download from<br/>GitHub Releases]
        DLGH --> EXTRACT[Extract Archive]
        EXTRACT --> INSTCLI[Install stigmer<br/>to ~/bin/]
        EXTRACT --> INSTSVR[Install stigmer-server<br/>to ~/bin/]
        INSTCLI --> WORK3[✓ stigmer local works!]
        INSTSVR --> WORK3
    end

    subgraph "Runtime - Binary Discovery"
        RUN[User runs:<br/>stigmer local]
        RUN --> FIND{Find stigmer-server?}
        FIND -->|Check 1| ENV[Check $STIGMER_SERVER_BIN]
        ENV -->|Not set| SAME[Check same directory<br/>as stigmer CLI]
        SAME -->|Found!| USE[Use stigmer-server]
        SAME -->|Not found| DEV_PATH[Check dev paths<br/>bin/, bazel-bin/]
        DEV_PATH -->|Found!| USE
        DEV_PATH -->|Not found| AUTO[Try auto-build<br/>if in workspace]
        AUTO -->|Success| USE
        AUTO -->|Failed| ERROR[Error: server not found]
        USE --> START[Start stigmer-server]
        START --> SUCCESS[✓ Ready!]
    end

    style WORK1 fill:#90EE90
    style WORK2 fill:#90EE90
    style WORK3 fill:#90EE90
    style SUCCESS fill:#90EE90
    style ERROR fill:#FFB6C1
```

## Step-by-Step Walkthrough

### 1. Development Workflow

```
Developer                              System
   |                                      |
   | make release-local                  |
   |------------------------------------>|
   |                                      |
   |                              Build stigmer
   |                           Build stigmer-server
   |                                      |
   |                              Install to ~/bin/
   |<------------------------------------|
   | ✓ Both installed                    |
   |                                      |
   | stigmer local                       |
   |------------------------------------>|
   |                                      |
   |                           Find stigmer-server
   |                              (same directory)
   |                                      |
   |                              Start services
   |<------------------------------------|
   | ✓ Running!                          |
```

### 2. Release Process

```
Developer                GitHub Actions               Users
   |                           |                        |
   | git tag v0.1.0           |                        |
   | git push                 |                        |
   |------------------------->|                        |
   |                          |                        |
   |                   Trigger workflow                |
   |                          |                        |
   |                    make protos                    |
   |                          |                        |
   |                    Build binaries                 |
   |                    (all platforms)                |
   |                          |                        |
   |                    Create archives                |
   |                    (both binaries)                |
   |                          |                        |
   |                    Upload to GitHub               |
   |                          |                        |
   |                    Update Homebrew                |
   |                          |----------------------->|
   |                          |                        |
   |                          |            brew install stigmer
   |                          |                        |
   |                          |              Download archive
   |                          |                        |
   |                          |           Extract both binaries
   |                          |                        |
   |                          |           Install to /opt/homebrew/bin/
   |                          |                        |
   |                          |<-----------------------|
   |                          |              ✓ Ready to use!
```

### 3. User Experience (Homebrew)

```
Terminal                                    Filesystem
   |                                             |
   | brew install stigmer                       |
   |------------------------------------------->|
   |                                             |
   |                                Download from GitHub
   |                                             |
   |                                    Extract archive:
   |                                      - stigmer
   |                                      - stigmer-server
   |                                             |
   |                                Install both to:
   |                            /opt/homebrew/bin/stigmer
   |                            /opt/homebrew/bin/stigmer-server
   |<--------------------------------------------|
   | ✓ Installation complete                     |
   |                                             |
   | stigmer local                              |
   |------------------------------------------->|
   |                                             |
   |                                Find server in same dir:
   |                              /opt/homebrew/bin/stigmer-server
   |                                             |
   |                                     Start server
   |<--------------------------------------------|
   | ✓ Ready! Stigmer is running                |
```

## Key Files & Their Roles

```
Repository
├── .goreleaser.yml              ← Defines how to build & package
│   ├── Builds stigmer CLI
│   ├── Builds stigmer-server
│   ├── Creates archives with BOTH
│   └── Generates Homebrew formula
│
├── .github/workflows/release.yml ← Automates releases
│   ├── Triggered by git tags
│   ├── Runs make protos
│   ├── Runs goreleaser
│   └── Uploads artifacts
│
├── scripts/install.sh            ← Shell installer
│   ├── Detects platform
│   ├── Downloads release
│   ├── Extracts both binaries
│   └── Installs to ~/bin/
│
├── Makefile
│   └── release-local             ← Dev installation
│       ├── Builds both binaries
│       └── Installs to ~/bin/
│
└── client-apps/cli/internal/cli/daemon/
    ├── daemon.go                 ← Binary discovery logic
    └── download.go               ← Auto-download fallback
```

## Archive Structure

Each release archive contains:

```
stigmer_0.1.0_Darwin_arm64.tar.gz
├── stigmer                    ← CLI (15MB)
├── stigmer-server             ← Server (25MB)
├── README.md                  ← Usage instructions
└── LICENSE                    ← Apache 2.0
```

## Homebrew Formula (Auto-generated)

```ruby
class Stigmer < Formula
  desc "AI-powered workflow automation"
  homepage "https://github.com/stigmer/stigmer"
  url "https://github.com/stigmer/stigmer/releases/download/v0.1.0/stigmer_0.1.0_darwin_amd64.tar.gz"
  sha256 "abc123..."
  version "0.1.0"

  def install
    bin.install "stigmer"          # ← Installs CLI
    bin.install "stigmer-server"   # ← Installs server
  end

  test do
    system "#{bin}/stigmer", "--version"
    system "#{bin}/stigmer-server", "--version"
  end
end
```

## Installation Methods Comparison

| Method | Command | Installs To | Auto-Updates | Best For |
|--------|---------|-------------|--------------|----------|
| **Homebrew** | `brew install stigmer` | `/opt/homebrew/bin/` | ✓ `brew upgrade` | macOS/Linux users |
| **Shell Script** | `curl install.sh \| bash` | `~/bin/` | ✗ Manual | Quick setup, CI/CD |
| **Manual Download** | Download + extract | Custom | ✗ Manual | Windows, custom setups |
| **Dev Build** | `make release-local` | `~/bin/` | ✗ Manual | Development |

## Binary Discovery Priority

When `stigmer local` runs, it searches for `stigmer-server` in this order:

```
1. $STIGMER_SERVER_BIN          Priority: 1  Use Case: Testing, CI/CD
   └─> If set, use this path

2. Same directory as CLI         Priority: 2  Use Case: Standard install
   ├─> /opt/homebrew/bin/stigmer-server   (Homebrew macOS)
   ├─> /usr/local/bin/stigmer-server      (Linux)
   └─> ~/bin/stigmer-server               (Shell script)

3. Development paths             Priority: 3  Use Case: Development
   ├─> bin/stigmer-server
   └─> bazel-bin/.../stigmer-server

4. Auto-build                    Priority: 4  Use Case: Dev fallback
   └─> Try: go build -o bin/stigmer-server ...

5. Auto-download (future)        Priority: 5  Use Case: Last resort
   └─> Download from GitHub releases
```

## Success Criteria

✅ **Single command installation**
```bash
brew install stigmer  # Gets both binaries
```

✅ **Zero configuration required**
```bash
stigmer local  # Just works, finds server automatically
```

✅ **Cross-platform support**
- macOS (Intel + Apple Silicon)
- Linux (AMD64 + ARM64)
- Windows (AMD64)

✅ **Automatic version matching**
- CLI and server always from same release
- No version mismatch issues

✅ **Standard packaging practices**
- Follows Homebrew conventions
- Works with existing package managers
- Easy to maintain and update

## Summary

This packaging strategy ensures:

1. **Users get both binaries** with one installation command
2. **CLI automatically finds server** via same-directory detection
3. **Zero configuration** - no environment variables needed
4. **Works everywhere** - Homebrew, shell script, manual install
5. **Automated releases** - Tag a version, everything else is automatic
6. **Professional UX** - Matches what users expect from modern CLI tools

The key insight: **Install both binaries to the same directory, and the CLI will find the server automatically.** Simple, reliable, standard.
