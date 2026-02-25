---
name: Remove new command
overview: Remove the `stigmer new` command and its exclusively-used embedded template/SDK scaffolding code. This is a clean deletion with no replacement -- `draft project` will be designed separately in the future.
todos:
  - id: delete-new-go
    content: Delete `client-apps/cli/cmd/stigmer/root/new.go`
    status: completed
  - id: remove-registration
    content: Remove `NewCommand()` registration line from `client-apps/cli/cmd/stigmer/root.go`
    status: completed
  - id: delete-templates-go
    content: Delete `client-apps/cli/embedded/templates.go`
    status: completed
  - id: delete-sdk-version-go
    content: Delete `client-apps/cli/embedded/sdk_version.go`
    status: completed
  - id: verify-build
    content: Run `go build ./...` in the CLI module to verify clean compilation
    status: completed
isProject: false
---

# Remove `stigmer new` Command

## What gets removed

### 1. Command file

- Delete `[client-apps/cli/cmd/stigmer/root/new.go](client-apps/cli/cmd/stigmer/root/new.go)` (341 lines) -- the entire command definition, handler, and helper functions (`newHandler`, `isValidProjectName`, `generateStigmerYAML`, `generateGitignore`, `generateReadme`).

### 2. Command registration

- In `[client-apps/cli/cmd/stigmer/root.go](client-apps/cli/cmd/stigmer/root.go)`, remove line 50:

```go
  rootCmd.AddCommand(withGroup(root.NewCommand(), "core"))
  

```

### 3. Embedded templates used only by `new`

- Delete `[client-apps/cli/embedded/templates.go](client-apps/cli/embedded/templates.go)` -- contains `AgentAndWorkflow()`, only caller is `new.go`.
- Delete `[client-apps/cli/embedded/sdk_version.go](client-apps/cli/embedded/sdk_version.go)` -- contains `GenerateGoModContent()`, `GetSDKVersionForTemplate()`, `findStigmerRepo()`. Only caller is `new.go`.

## What stays (verified safe)

- `embedded/version.go` -- `GetBuildVersion()` is used by the daemon (`daemon.go` lines 125, 1455). Not touched.
- All other `embedded/*.go` files (binary extraction, platform-specific embeds) -- unrelated to `new`.
- The `embedded` package itself remains intact (still has `version.go`, `embedded.go`, `extract.go`, platform files).

## Verification

- After deletion, run `go build ./...` from the CLI module root to confirm clean compilation.

