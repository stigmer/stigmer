# What is Seedpack?

## One-Sentence Positioning

**Seedpack is a Stigmer project bundled inside the CLI binary that automatically bootstraps every fresh Stigmer server with a set of built-in system agents, skills, and MCP servers—so the platform is useful the moment it starts.**

---

## Executive Summary

Seedpack is the answer to a bootstrapping problem: how does a brand-new Stigmer server know how to help you create agents and skills before you have created any agents and skills?

The answer is that it does not start empty. The Stigmer CLI binary embeds a complete, valid Stigmer project—the seedpack—using Go's `embed` directive. When you start the server for the first time, the CLI automatically runs `stigmer apply` against the embedded project, seeding the server with the core system resources it needs. From that point on, commands like `stigmer draft agent` and `stigmer draft skill` work because the agents and skills that power them are already there.

Seedpack is not a special code path or a hardcoded shortcut. It is a regular Stigmer project stored inside the binary. It goes through the exact same `stigmer apply` pipeline that your own projects do. The only difference is that nobody had to author it manually—it ships with Stigmer.

---

## The Problem Seedpack Solves

### The Cold-Start Problem

Stigmer's value proposition is that you can use AI agents to *build and manage* AI agents. The agent-creator agent drafts new agents for you. The skill-creator agent packages new skills. The mcp-server-creator agent scaffolds new MCP server definitions.

But these helpers are themselves Stigmer resources—agents backed by skills. They need to exist on the server before they can be used.

Without seedpack, you would face a circular dependency: you need agents to create agents, but you need to create agents before you have any. Someone would have to manually apply a base set of resources on every new install, and that set would need to stay in sync with every new version of the CLI.

Seedpack eliminates this entirely. The base resources live in the binary. Every install gets exactly the right version automatically.

### The "Where Do I Start?" Problem

A secondary benefit: seedpack's `agents/`, `skills/`, and `mcp-servers/` directories are fully valid, well-formed Stigmer resources. They are the canonical examples of how to structure an agent with skills, how to write a `SKILL.md`, and how to define an MCP server. A new contributor looking for a reference does not need to hunt through tests or documentation—the seedpack is right there in the repo at `seedpack/`.

---

## What's Inside

```
seedpack/
├── stigmer.yaml                    # Project manifest (kind: Project)
│
├── agents/
│   ├── agent-creator.yaml          # Drafts new Agent YAML files
│   ├── skill-creator.yaml          # Drafts and packages new skills
│   └── mcp-server-creator.yaml     # Scaffolds new MCP server definitions
│
├── skills/
│   ├── agent-creator/
│   │   ├── SKILL.md                # Agent authoring guidelines
│   │   └── references/             # Schema docs, examples, validation guides
│   ├── skill-creator/
│   │   ├── SKILL.md                # Skill authoring guidelines
│   │   ├── provenance.json         # Upstream vendoring metadata
│   │   ├── references/             # Packaging workflows, output patterns
│   │   └── scripts/                # init_skill.py, package_skill.py
│   └── mcp-server-creator/
│       ├── SKILL.md                # MCP server authoring guidelines
│       └── references/             # Schema docs, examples, agent integration
│
├── mcp-servers/
│   └── stigmer-mcp-server.yaml     # Built-in MCP server for Stigmer resources
│
└── tools/                          # Build-time scripts only — NOT embedded
    ├── regenerate_all.sh
    ├── vendor-sources.json
    └── *.sh                        # Per-resource draft/vendor scripts
```

The `tools/` directory is explicitly excluded from the binary. It contains the scripts used to generate and update seedpack content during development, but they have no place at runtime.

### The Three System Agents

**`agent-creator`** — Given a description of what you want an agent to do, it drafts a complete, valid `Agent` YAML spec. It uses the `agent-creator` skill to stay up to date with the Agent schema and best practices.

**`skill-creator`** — Drafts and packages a new skill directory including a `SKILL.md` with the right frontmatter, reference files, and any helper scripts. Uses the `skill-creator` skill.

**`mcp-server-creator`** — Scaffolds a new `McpServer` YAML definition. Knows the McpServer schema and how to wire tools correctly.

### The Built-In MCP Server

`stigmer-mcp-server.yaml` defines an MCP server that exposes Stigmer's own resources—agents, skills, workflows, MCP servers—as tools the system agents can call. This is how `agent-creator` can query the existing agents on the server before drafting a new one, avoiding duplicates and maintaining consistency.

---

## How Bootstrap Works

### Embed at Build Time

The entire `agents/`, `skills/`, and `mcp-servers/` tree is embedded into the CLI binary using Go's `//go:embed` directive in `embed.go`. The `tools/` directory is excluded. The result is a self-contained binary that carries the seedpack as an in-memory filesystem.

### Content Hash for Idempotency

At startup, the CLI computes a **SHA-256 content hash** over every embedded file (path + content). It compares this hash against a `.seedpack-bootstrapped` flag stored in the server's SQLite `bootstrap_state` table.

- **Hash matches** → seedpack is current, skip bootstrap.
- **Hash differs** (new CLI version, seedpack content changed) → re-bootstrap.
- **No record** (first run) → bootstrap.

This means:
1. Bootstrap is fully idempotent—running `stigmer server start` 100 times does not apply seedpack 100 times.
2. Upgrading the CLI automatically re-seeds the server if any system resource changed.
3. Deleting the flag record in SQLite forces a re-bootstrap on the next start.

### Bootstrap Execution

When a bootstrap is needed:

```
1. CLI computes seedpack.ContentHash()
2. Compares against bootstrap_state table in SQLite
3. If stale or missing:
   a. Extracts embedded files to a temp directory (seedpack.ExtractToDir)
   b. Sets STIGMER_SKIP_SEEDPACK_BOOTSTRAP=true (recursion guard)
   c. Runs: stigmer apply --config <temp-dir>
   d. Cleans up temp directory
   e. Writes new hash to bootstrap_state table
```

Step (c) is the key insight: the bootstrap uses the exact same `stigmer apply` command a user would run against their own project. There is no special seedpack import path in Stigmer Server. The server receives the agents, skills, and MCP servers exactly as if a user had applied them manually.

The `STIGMER_SKIP_SEEDPACK_BOOTSTRAP` environment variable prevents the recursive apply process from triggering another bootstrap, which would happen because the apply command also starts a daemon.

---

## Lifecycle Diagram

```
Build time
──────────
seedpack/ ──[go:embed]──► CLI binary (in-memory filesystem)

First `stigmer server start`
──────────────────────────
CLI binary starts
  │
  ├── Computes seedpack.ContentHash()
  ├── Reads bootstrap_state from SQLite
  │   (no record → bootstrap needed)
  │
  ├── seedpack.ExtractToDir() → /tmp/stigmer-seedpack-XXXX/
  │   ├── agents/*.yaml
  │   ├── skills/*/
  │   ├── mcp-servers/*.yaml
  │   └── stigmer.yaml
  │
  ├── STIGMER_SKIP_SEEDPACK_BOOTSTRAP=true
  └── stigmer apply --config /tmp/stigmer-seedpack-XXXX/
        │
        └── Same pipeline as user projects:
            ├── Apply agent-creator agent
            ├── Apply skill-creator agent
            ├── Apply mcp-server-creator agent
            ├── Package & upload skill artifacts
            └── Apply stigmer-mcp-server

  ├── bootstrap_state updated with new hash
  └── Server ready

Subsequent starts (hash unchanged)
───────────────────────────────────
CLI binary starts
  ├── ContentHash() matches bootstrap_state
  └── Skip — server ready immediately

CLI upgrade (hash changed)
───────────────────────────
CLI binary starts
  ├── ContentHash() differs from bootstrap_state
  └── Re-bootstrap with updated system resources
```

---

## How Seedpack Relates to User Projects

Seedpack is, structurally, just a Stigmer project. The `stigmer.yaml` at its root is `kind: Project`—exactly what you would write for your own project. This is intentional.

| | Seedpack | Your project |
|---|---|---|
| Applied with | `stigmer apply` | `stigmer apply` |
| Project manifest | `stigmer.yaml` | `stigmer.yaml` |
| Contains | agents, skills, mcp-servers | agents, skills, mcp-servers, workflows |
| Visibility | `stigmer.ai/system: "true"` label | no system label |
| Versioned by | CLI binary version | your source control |
| Where it lives | embedded in CLI binary | your filesystem |

The system label (`stigmer.ai/system: "true"`) on seedpack agents is purely for the CLI to distinguish built-in resources from user-created ones when displaying lists or providing help text. It does not change how the resources behave at runtime.

---

## Updating Seedpack

Seedpack content is generated and updated using the scripts in `seedpack/tools/`. These are not part of the embedded binary—they run only at development time.

```bash
cd seedpack/tools

# Regenerate all seedpack content
./regenerate_all.sh

# Or step by step:
./01_vendor_skill.sh         # Vendor skill-creator from upstream source
./02_draft-agent-creator-skill.sh
./03_draft-skill-creator-agent.sh
# ... and so on
```

`vendor-sources.json` tracks the upstream sources for vendored content (e.g., the `skill-creator` skill is vendored from an Anthropic-maintained source). Running `./01_vendor_skill.sh` re-fetches and updates that content.

After updating any seedpack file, the content hash changes automatically on the next build. No manual version bump is needed—the hash-based detection handles it.

---

## What This Means for Contributors

**If you change an agent or skill in `seedpack/`:** The change will be picked up automatically on the next `stigmer server start` after a binary rebuild, because the content hash will differ. You do not need to manually reset any state.

**If you want to force a re-bootstrap during development:** Delete the `bootstrap_state` record from the SQLite database, or delete the database file entirely (`~/.stigmer/stigmer.db`).

**If you want to skip bootstrap entirely:** Set `STIGMER_SKIP_SEEDPACK_BOOTSTRAP=true` before starting the server.

**If you are adding a new system resource to seedpack:** Add the YAML file under `agents/`, `skills/`, or `mcp-servers/`, add the `stigmer.ai/system: "true"` annotation, and update `embed.go` if needed to ensure the new path is covered by the embed glob. The hash change will trigger bootstrap on next start.

---

## Further Reading

- [What is an Agent?](what-is-agent.md) — The resource type that seedpack agents are instances of
- [What is Stigmer Server?](what-is-stigmer-server.md) — The server seedpack bootstraps
- [Seedpack source](../../seedpack/) — The implementation and embedded content
