---
name: README Rewrite
overview: Rewrite README.md to be accurate, non-redundant, and genuinely useful. Remove fabricated examples, dead sections, and repeated prose. Replace everything with content verified against the actual codebase.
todos:
  - id: delete-python-sdk
    content: Remove Python SDK section entirely (lines 472-487) — SDK does not exist
    status: completed
  - id: rewrite-go-sdk-example
    content: Rewrite Go SDK example to use real stigmer.Run() + struct-args API from sdk/go/examples/
    status: completed
  - id: fix-cli-commands
    content: "Fix all CLI command references: stigmer agent execute → stigmer run, stigmer workflow execute → stigmer run, remove stigmer init, stigmer login, stigmer local restart"
    status: completed
  - id: fix-prereqs
    content: Fix Go version prerequisite from 1.21 to 1.25+ and update binary description (single BusyBox binary, not two separate binaries)
    status: completed
  - id: fix-paths-and-links
    content: Fix CLI source path (cmd/stigmer → client-apps/cli/cmd/stigmer), remove dead docs/api/ link, fix workflow YAML example to match actual syntax
    status: completed
  - id: consolidate-local-cloud
    content: Merge three redundant local/cloud sections into one clear section
    status: completed
  - id: remove-duplicate-diagram
    content: Remove the 'Local Development Stack' duplicate architecture diagram, keep the cleaner one
    status: completed
  - id: cut-overengineered-sections
    content: Cut Storage Strategy to 2-3 sentences, remove gRPC protobuf section, remove cloud internal tech stack details
    status: completed
  - id: add-missing-concepts
    content: Add Skills and Environments to Core Concepts section, add real CLI command surface (run, apply, draft, backend)
    status: completed
  - id: final-review
    content: Read the final README end-to-end and verify every command, path, and link against the codebase before considering done
    status: completed
isProject: false
---

# README.md Rewrite Plan

## What We're Fixing

The README has three categories of problems discovered by cross-referencing every claim against the real codebase.

---

## Category 1: Outright Incorrect — Must Be Fixed

These will mislead users trying to use the project.

**a. Python SDK section (lines 472–487) — delete entirely**

- `sdk/python/` does not exist. Zero files. This section is aspirational fiction.

**b. Go SDK examples (lines 445–468) — rewrite completely**

- README shows a fabricated API: `workflow.New("data-pipeline")` with `wf.Task(...)` and `wf.Execute()`
- Actual API uses `stigmer.Run(func(ctx *stigmer.Context) error {...})` with `agent.New(ctx, "name", &agent.AgentArgs{...})` — Pulumi-aligned struct args pattern
- Source of truth: `[sdk/go/examples/01_basic_agent.go](sdk/go/examples/01_basic_agent.go)` and `[sdk/go/examples/07_basic_workflow.go](sdk/go/examples/07_basic_workflow.go)`

**c. CLI command names throughout — fix all occurrences**

- `stigmer agent execute` → does not exist. Actual command: `stigmer run`
- `stigmer workflow execute` → does not exist. Actual command: `stigmer run`
- `stigmer init` → does not exist (no `init` subcommand registered in `[root.go](client-apps/cli/cmd/stigmer/root.go)`)
- `stigmer login` → does not exist (not in registered command list)
- `stigmer local restart` (troubleshooting section line 569) → stale, no `local` subcommand

**d. Go version prerequisite (line 626) — fix**

- README says "Go 1.21 or later". Actual: `go 1.25.6` (confirmed in `[go.work](go.work)`)

**e. CLI binary description — fix**

- README says Homebrew "installs both `stigmer` CLI and `stigmer-server` binaries"
- Actual: single BusyBox binary (~123MB) that embeds all components, confirmed in `[client-apps/cli/README.md](client-apps/cli/README.md)`

**f. CLI source path — fix**

- Architecture diagram cites `(cmd/stigmer - Open Source)` as the CLI location
- Actual path: `client-apps/cli/cmd/stigmer/`

**g. Dead link — remove or fix**

- `[API Reference](docs/api/)` — this directory does not exist

**h. Workflow YAML example — fix syntax**

- README shows simplified YAML with `agent:` and `inputs:` directly on tasks
- Actual format uses `kind: agent_call`, `task_config:`, `export:`, `flow:` — confirmed in `[examples/workflows/pr-review.yaml](examples/workflows/pr-review.yaml)`

---

## Category 2: Structural — Consolidate and Cut

**i. "Why Stigmer?" + "Open Source vs Cloud" + "Local vs. Cloud" — three sections saying the same thing**

- Merge into one clear section. The local/cloud duality is explained identically three times across lines 8–15, 281–298, and 388–440.

**j. Two architecture diagrams — keep one, delete the other**

- "Architecture" diagram (lines 129–168) and "Local Development Stack" diagram (lines 200–234) convey nearly identical information.
- Keep the layered one (more useful), delete the duplicate.

**k. Storage Strategy section (lines 250–279) — cut to 2 sentences**

- Eight checkmark bullet points selling SQLite plus a schema dump. This is an internal design justification, not user-facing documentation. One paragraph is enough.

**l. gRPC Service Architecture section (lines 490–515) — remove**

- Raw protobuf in a user-facing README is implementation detail. It adds nothing for a user trying to run the tool. It belongs in `docs/architecture/`.

**m. Cloud internal tech details (lines 293–298) — remove**

- "stigmer-service (Java Spring Boot with MongoDB)", "Auth0 + FGA" — these are proprietary implementation details that leak internal architecture into a public OSS README with no benefit to the reader.

---

## Category 3: Missing — Add

**n. Skills and Environments — add to Core Concepts**

- `examples/skills/`, `sdk/go/skill/`, `sdk/go/environment/` confirm these are first-class platform concepts. The current "Core Concepts" section covers only Agents, Workflows, and MCP Servers — omitting major functionality.

**o. Actual CLI command surface — add**

- The real commands (`stigmer run`, `stigmer apply`, `stigmer draft`, `stigmer backend`) are not shown anywhere. Users have no idea how to actually interact with the platform beyond the basic `stigmer server`.

---

## Resulting Structure

The new README will follow this structure (target: ~300–350 lines, down from 762):

```
# Stigmer
One-paragraph pitch (no repetition)

## Quick Start
Install → stigmer server → stigmer run — three steps, accurate commands

## Core Concepts
Agent / Workflow / Skill / Environment / MCP Server
(real YAML examples matching actual file format)

## Go SDK
Real stigmer.Run() + struct-args example

## CLI Reference
Actual command surface: run, apply, get, list, draft, push, server, mcp-server, backend

## Local vs Cloud
Single consolidated section (not three)

## Architecture
One diagram, accurate component paths

## Development
Prerequisites (Go 1.25+), build from source, proto generation, releasing

## Contributing / Community / License
```

---

## Files Changed

- `[README.md](README.md)` — the only file being modified

---

## One Open Question

During research I found that `[sdk/go/README.md](sdk/go/README.md)` contains stale import paths (`github.com/leftbin/stigmer-sdk/go`) while the actual `go.mod` uses `github.com/stigmer/stigmer/sdk/go`. This README rewrite will cite the correct module path.

However: should the SDK section in the main README include installation instructions (`go get ...`) or just point to `sdk/go/README.md`? My recommendation is to show a minimal working example and link to the SDK README for full docs — keeping the main README lean. Flag if you want a different approach.