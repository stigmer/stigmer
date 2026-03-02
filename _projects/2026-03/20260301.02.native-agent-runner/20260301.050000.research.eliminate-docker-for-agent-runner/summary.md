# Eliminating Docker for Agent-Runner — Research Summary

**Date:** 2026-03-01
**Source:** ChatGPT Deep Research
**Verdict:** Clear Winner — Hermetic CPython runtime bundle managed by Go CLI

---

## Key Finding

The most reliable way to eliminate Docker for a complex Python daemon is **not** to "freeze Python harder" (PyInstaller, Nuitka, cx_Freeze), but to **ship CPython like a runtime** — exactly what `python-build-standalone` and `uv` are designed to enable.

## Approach Comparison

| Approach | Feasibility | UX | Size | Maintenance | Verdict |
|----------|------------|-----|------|-------------|---------|
| **python-build-standalone + venv (CLI-managed)** | Best fit | Zero-config | < 200MB | Medium | **RECOMMENDED** |
| PEX with bundled interpreter (SCIE) | Strong | Excellent | Medium | Medium | Second choice |
| uv bootstrap on first run | Very feasible | Network-dependent | Smallest | Medium | Third choice |
| PyInstaller (revisited) | Brittle — dynamic imports not solved | Good if stable | 100-300MB | **High** | NOT recommended |
| Nuitka | Complex builds, edge cases | Good | Large | High | NOT recommended |
| cx_Freeze | Same dynamic import issues | Good | Variable | High | NOT recommended |
| Embedded Python in Go (cgo) | High complexity, weak bindings | Invisible | Variable | **Very high** | NOT recommended |
| GraalPy | Temporal SDK incompatible | N/A | N/A | N/A | **Blocked** |

## Why Frozen Binaries Still Fail

The research confirms that PyInstaller, Nuitka, and cx_Freeze **have not solved** the core failure mode from January 2026:

- Dynamic imports (`multipart`, `deepagents`) still require manual hooks/hidden-import configuration
- The `multipart` vs `python-multipart` naming conflict is a well-documented packaging ecosystem problem
- `deepagents-cli` namespace collision corrupts imports regardless of packaging tool
- Native extensions (Rust/pyo3 in temporalio, C in grpcio) add platform-specific complexity

## Why Hermetic CPython Runtime Wins

| Property | Docker (current) | Hermetic CPython (recommended) |
|----------|-----------------|-------------------------------|
| Import semantics | Normal (real CPython) | Normal (real CPython) |
| Native extensions | Work naturally | Work naturally |
| Docker Desktop required | Yes | **No** |
| Home directory warning | Yes (alarming UX) | **None** |
| Image / runtime size | ~2 GB | **< 200 MB** |
| Startup time | ~3s (cold) | **< 1s** |
| Debugging | Shell into container | **Direct process, standard tools** |
| macOS VM overhead | 2-4 GB memory | **None** |
| Licensing (Docker Desktop) | Paid for >250 employees | **None** |

## MCP Server Runtime Strategy

The Docker image is large (~2GB) because it bundles Node.js, Go, Docker CLI, and uv/uvx for MCP server spawning. The research recommends a **tiered approach**:

| Tier | MCP Server Type | Strategy |
|------|----------------|----------|
| A | Python (`uvx`) | Works out of the box — same CPython runtime |
| B | Node.js (`npx`) | Lazy-install on first use |
| C | Go (`go run`) | Prefer prebuilt binaries over full toolchain |
| D | Docker | Optional — user-provided Docker only |

## Implementation Phases

1. **Phase 1** (1.5-2 weeks): Hermetic runtime bootstrap, wheelhouse build pipeline, dual-path execution (native + Docker fallback)
2. **Phase 2** (0.5-1 week): Decouple MCP runtimes, implement tiered policy
3. **Phase 3** (0.5 week): Remove Docker from core path, retain as optional sandbox

## Key Risks

| Risk | Mitigation |
|------|-----------|
| Platform wheel gaps (Linux arm64) | Build wheels ourselves in CI |
| `deepagents-cli` namespace collision | Controlled install order + repair step (same as Docker workaround) |
| macOS quarantine on downloaded binaries | `xattr` removal in bootstrap; distribute through trusted channels |
| Supply-chain security of downloaded CPython | Checksum/signature verification, hash pinning |
| First-run bootstrap time | Offline wheelhouse bundled with release |

---

_Summary generated: 2026-03-01_
_Full report: `04.report.gpt.md`_
