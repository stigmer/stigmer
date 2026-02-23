# Agent-Runner: Generic STDIO MCP Server Runtime

**Date**: February 23, 2026

## Summary

Transformed the agent-runner from an image with a baked-in stigmer CLI binary into a generic STDIO MCP server runtime. The image now ships four universal runtime tools — npx, uvx, go, and docker — enabling any MCP server to be pulled, built, and run dynamically at agent execution time. The built-in Stigmer MCP server is no longer compiled into the image; it uses `go run …@latest` via the seedpack YAML.

## Problem Statement

The agent-runner Dockerfile included a heavyweight Go build stage that compiled the entire stigmer CLI solely to provide the `stigmer mcp-server` binary. This design had fundamental issues:

### Pain Points

- The agent-runner could only spawn the single MCP server whose binary was baked in
- Adding new MCP servers required rebuilding the Docker image each time
- The Go builder stage copied most of the monorepo just to compile one binary, bloating build times and layer cache
- The `mcp-server/go.mod` had a `replace` directive pointing to a local path, making remote `go run` / `go install` impossible
- The `apis/stubs/go` sub-module had never been tagged, blocking the Go module proxy from resolving it

## Solution

Shift the MCP server execution model from "pre-compiled binary in image" to "dynamic subprocess spawned at runtime". Equip the agent-runner with the four most common tools for launching STDIO MCP servers and let the seedpack YAML declare exactly how each server is started.

## Implementation Details

### 1. Go Module Publishing (`mcp-server/go.mod`)

- Tagged the `apis/stubs/go` sub-module as `v0.0.1` on the main branch and pushed the tag
- Forced the Go module proxy to index the new tag via `GOPROXY=proxy.golang.org go list -m`
- Removed the `replace github.com/stigmer/stigmer/apis/stubs/go => ../apis/stubs/go` directive
- Pinned the dependency to `github.com/stigmer/stigmer/apis/stubs/go v0.0.1`
- Verified with `go mod tidy`, `go build ./...`, `go test -v -race ./...`

### 2. Agent-Runner Dockerfile Refactoring

- **Removed**: The entire "Go Builder: Compile Stigmer CLI" stage (7 `COPY` commands, `go build`, binary copy)
- **Added**: Four runtime tools via multi-stage copy:
  - `docker` CLI from `docker:27-cli`
  - Go toolchain from `golang:1.25`
  - `uv` and `uvx` from `ghcr.io/astral-sh/uv:latest`
  - `npx` already present via the existing Node.js installation
- Configured the non-root `stigmer` user with a writable `GOPATH` at `/home/stigmer/go`
- Added a verification `RUN` step that prints versions for all seven tools (node, npm, npx, go, docker, uv, uvx)

### 3. Seedpack YAML & Version Bump

- Updated `stigmer-mcp-server.yaml` from `command: stigmer, args: [mcp-server]` to `command: go, args: [run, github.com/stigmer/stigmer/mcp-server/cmd/mcp-server-stigmer@latest]`
- Bumped seedpack `manifest.json` version from `1.2.0` to `1.3.0`
- Updated test assertions in `seedpack_test.go` and `bootstrap_test.go` to match the new command structure and version

### 4. Documentation

- Rewrote `mcp-server/README.md` with comprehensive installation options (Go install, Docker, Stigmer CLI, build from source), per-IDE client configuration examples (Cursor, Claude Desktop/Code, VS Code/Copilot, Windsurf), environment variable reference, HTTP mode, and architecture overview — modeled after the GitHub MCP Server README
- Updated the main `README.md` with a "MCP Servers" section linking to the MCP server README with usage examples

## Benefits

- **Dynamic MCP servers**: Any STDIO MCP server (Node, Python, Go, Docker) can be configured in a seedpack YAML and spawned at runtime without image changes
- **Faster builds**: Removed the heavy Go builder stage that copied most of the monorepo
- **Remote `go install` / `go run`**: The Stigmer MCP server can now be installed by anyone from the Go module proxy (after merge and tagging `mcp-server/v0.1.0`)
- **Self-documenting**: The README provides drop-in configuration blocks for every major MCP client IDE
- **Smaller attack surface**: No custom binaries baked into the image; tools are fetched at runtime

## Impact

- **Agent-runner**: Fundamentally changes how MCP servers are provisioned — from static to dynamic
- **Seedpack consumers**: Any user-defined MCP server YAML with a `command`/`args` pair will "just work" if the corresponding runtime tool is available
- **Open-source users**: Can now `go install` or `docker run` the Stigmer MCP server without cloning the repo
- **Test suite**: All seedpack and bootstrap tests updated and passing

## Post-Merge Action Required

After these changes land on `main`, tag `mcp-server/v0.1.0` so that `go run github.com/stigmer/stigmer/mcp-server/cmd/mcp-server-stigmer@latest` resolves to the version without the replace directive:

```bash
git tag mcp-server/v0.1.0 <merge-commit-sha>
git push origin mcp-server/v0.1.0
```

## Related Work

- [Agent-Runner Zip Extraction](_changelog/2026-02/2026-02-23-195811-agent-runner-zip-extraction.md) — parallel Dockerfile changes for directory attachment support
- Seedpack MCP Server Phase 1–3 — foundational seedpack integration that this work builds on

---

**Status**: ✅ Production Ready (pending merge and module tagging)
**Timeline**: ~3 hours
