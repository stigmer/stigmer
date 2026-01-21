# Design Decision 001: PyInstaller Standalone Binary Over Docker Containers

**Date**: 2026-01-21  
**Status**: Accepted  
**Decision Makers**: Suresh (after Gemini consultation)

## Context

agent-runner is a Python-based service that needs to run on user machines. We need to distribute it in a way that:
1. Works reliably across platforms (Linux, macOS, Windows)
2. Requires minimal user setup
3. Integrates cleanly with stigmer daemon
4. Follows consistent patterns with other components

We evaluated two approaches:
- **Option A**: Docker container distribution
- **Option B**: PyInstaller standalone binary

## Decision

**We chose PyInstaller standalone binary** (Option B).

## Rationale

### Pattern Consistency

We already have an established pattern with Temporal:
```
Temporal:       Download binary → Run ✅
Agent-Runner:   Download binary → Run 🎯 (PyInstaller)
```

NOT:
```
Temporal:       Download binary → Run ✅
Agent-Runner:   Manage container ❌ (Docker)
```

**Architecture should be consistent.** If the pattern for one component is "download and run a binary," then all similar components should follow the same pattern.

### Daemon Complexity

**PyInstaller Approach** (Simple):
```go
// Daemon manages TWO binaries identically
func (s *Supervisor) EnsureComponents() error {
    downloadIfMissing("temporal", temporalURL)
    downloadIfMissing("agent-runner", agentRunnerURL)  // Same logic!
    return nil
}

func (s *Supervisor) StartAgentRunner() {
    exec.Command("~/.stigmer/bin/agent-runner").Start()  // Just run it
}
```

**Docker Approach** (Complex):
```go
// Daemon needs container orchestration logic
func (s *Supervisor) EnsureComponents() error {
    downloadIfMissing("temporal", temporalURL)
    
    // Different logic for agent-runner
    checkDockerInstalled()
    pullImage("ghcr.io/stigmer/agent-runner:v1.2.3")
    manageContainerLifecycle()
    setupNetworking()
    handleVolumeMounts()
    return nil
}
```

PyInstaller keeps daemon logic uniform and simple.

### User Requirements

**PyInstaller** (Zero Dependencies):
- ✅ No Docker/Podman required
- ✅ No Python required
- ✅ No container runtime
- ✅ Works on any machine

**Docker** (Additional Dependency):
- ❌ Requires Docker Desktop (Mac) or Docker Engine (Linux)
- ❌ Requires Podman on some Linux systems
- ❌ User must have container runtime installed and running
- ❌ Higher barrier to entry

**Impact**: Lower barrier to entry = better user experience.

### Distribution Simplicity

**PyInstaller**:
```
releases.stigmer.ai/
└── v1.2.3/
    ├── linux-amd64/agent-runner
    ├── linux-arm64/agent-runner
    ├── darwin-amd64/agent-runner
    ├── darwin-arm64/agent-runner
    └── windows-amd64/agent-runner.exe
```

Simple HTTP downloads, no registry authentication.

**Docker**:
```
ghcr.io/stigmer/agent-runner:v1.2.3
- Requires registry authentication
- Requires container runtime
- More complex error handling
```

### Real-World Examples

Other CLI tools with embedded runtimes use binaries, not containers:

| Tool | Runtime | Distribution |
|------|---------|--------------|
| Temporal CLI | Go | Binary ✅ |
| Pulumi | Node.js | Binary (pkg) ✅ |
| Deno | Rust/V8 | Binary ✅ |
| esbuild | Go | Binary ✅ |

**Pattern**: Distribute as self-contained binaries, not containers.

## Consequences

### Positive

1. **Consistency**: agent-runner follows same pattern as Temporal
2. **Simplicity**: Daemon code is uniform for all binaries
3. **User Experience**: Zero external dependencies required
4. **Distribution**: Simple HTTP downloads, no registry
5. **Development**: Build locally without Docker overhead

### Negative

1. **Binary Size**: 60-100MB (includes Python interpreter + deps)
   - **Mitigation**: Acceptable for dev tools, one-time download
2. **Build Complexity**: Need multi-platform builds in CI
   - **Mitigation**: GitHub Actions matrix handles this easily
3. **Startup Time**: Frozen Python can be slower
   - **Mitigation**: Long-running process, startup once

### Trade-offs Accepted

- **Larger binary size** vs **zero dependencies**: We accept larger binaries
- **Build complexity** vs **runtime simplicity**: We optimize for runtime experience

## Alternatives Considered

### 1. Docker Containers (Rejected)
- **Pros**: Standard for Python apps, isolated environment
- **Cons**: Requires Docker/Podman, complex lifecycle, inconsistent with Temporal pattern
- **Why Rejected**: Overengineering, unnecessary complexity

### 2. Portable Python + venv (Rejected)
- **Pros**: "Pure" Python solution
- **Cons**: Complex setup, fragile, large download, directory vs binary
- **Why Rejected**: More complex than PyInstaller with same downsides

### 3. Nuitka (Deferred)
- **Pros**: C compilation, faster startup, smaller binaries
- **Cons**: More complex build, compatibility issues
- **Why Deferred**: PyInstaller is proven and simpler; Nuitka is a future optimization

## Implementation Notes

- Use PyInstaller `--onefile` for single executable
- Optimize with `excludes` to reduce size
- Enable UPX compression if available
- Keep Poetry for development workflow
- Binary is for distribution only

## Review and Revision

This decision can be revisited if:
- PyInstaller proves unreliable across platforms
- Binary size becomes prohibitive (>150MB)
- Dependency compatibility issues are insurmountable
- Container approach becomes industry standard for CLI tools

## References

- Gemini conversation captured in `_cursor/adr-use-python-binary.md`
- Obsoleted Docker project: `_projects/2026-01/20260121.02.agent-runner-container-architecture/`
- PyInstaller documentation: https://pyinstaller.org/
- Industry examples: Temporal, Pulumi, Deno all use standalone binaries

---

**Decision**: Use PyInstaller to create standalone binaries for agent-runner distribution.
