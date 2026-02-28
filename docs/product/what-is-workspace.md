# What is a Workspace?

## One-Sentence Positioning

**A Workspace is the filesystem an agent operates in — the same way a terminal session has a working directory, every agent session has a workspace.**

---

## Executive Summary

A Workspace is the persistent filesystem environment that backs an agent's Session. It is not an API resource you create independently. Instead, you declare where the workspace content comes from when you create (or run) a session, and Stigmer provisions it automatically before the first execution begins.

Two sources are supported:

- **Git repository** — clone a repository from GitHub or any HTTPS-accessible git host. The agent operates in the cloned tree, reading and modifying files exactly as if it had cloned the repo itself.
- **Local path** — point the agent at a directory on your machine. The agent operates directly on your files, no copy or upload required. This is local mode only.

When no workspace is specified, the agent runs in an empty scratch directory — the default behavior, fully backward-compatible with any existing agents.

The workspace is a **session-level concept**: it is provisioned once, on the first execution, and reused by every subsequent execution in the same session. Agents accumulate file state across turns the way your terminal session accumulates state across commands.

---

## The Problem Workspaces Solve

### Agents Without a Workspace Are Limited to What You Hand Them

Without a workspace, an agent starts each execution in an empty directory. If you want the agent to work on an existing codebase, you have two bad options:

1. **Upload files as attachments.** You select and upload the files you think are relevant, the CLI compresses and uploads them to object storage, and the agent receives them as read-only copies in a staging directory. If you missed a file, you re-run. If the agent modifies a file, you download an artifact, inspect it, and apply the diff yourself.

2. **Paste content into the message.** This hits context window limits immediately for anything larger than a few files.

Neither option scales. A code review agent that cannot browse the repository it is reviewing is not useful. A refactoring agent that receives five files when it needs fifteen is not useful.

### The Cost

- Every file transfer is bandwidth you pay for and latency you wait on
- Attachments are copies — the agent reads a snapshot, not the live tree
- You decide what files are "relevant" before the agent has even looked at the codebase
- Modified files come back as artifacts you have to apply manually
- There is no continuity — the next execution starts fresh in another empty directory

---

## The Two Workspace Sources

### `GitRepoSource` — Clone a Repository

The agent clones the repository into its session workspace. From the first execution onward, the agent can read every file in the repo and create, modify, or delete files as it works.

**CLI:**
```bash
# Default branch, shallow clone (depth 1)
stigmer run agent code-reviewer --workspace https://github.com/acme/backend.git -m "Review open PRs"

# Specific branch
stigmer run agent code-reviewer \
  --workspace https://github.com/acme/backend.git \
  --branch feature/auth-refactor \
  -m "Review this branch"

# Pinned to an exact commit
stigmer run agent code-reviewer \
  --workspace https://github.com/acme/backend.git \
  --branch main \
  --commit a1b2c3d4e5f6 \
  -m "Audit the state of main as of this commit"
```

**Session YAML (if creating a session explicitly):**
```yaml
spec:
  workspace_source:
    git_repo:
      url: "https://github.com/acme/backend.git"
      branch: "feature/auth-refactor"
      commit: "a1b2c3d4"   # optional: pin to exact SHA
      # depth omitted → shallow clone with depth 1 (fast default)
      # depth: 0         → full clone with complete history
```

**Constraints and behavior:**

| | |
|---|---|
| URL scheme | HTTPS only. `https://` required. SSH URLs (`git@...`) are rejected with a clear error. |
| Authentication | Provide `GITHUB_TOKEN` in your environment (`.env` file or `--env`). The provisioner injects it for the clone operation, then strips it before the agent runtime starts. The agent never sees the token. |
| Branch + Commit | Can be combined: the branch is cloned first (enabling shallow clone), then the exact commit is checked out. |
| Clone depth | Absent → depth 1 (fast). `depth: 0` → full history. `depth: N` → N commits. |
| Scope | Works in both local mode and Stigmer Cloud. |

---

### `LocalPathSource` — Use Your Files Directly

The agent operates directly on an existing directory on your machine. No copy is made. The agent reads and writes your files in place. Changes are immediately visible in your editor.

**CLI:**
```bash
# Point at the current directory
stigmer run agent refactorer --workspace . -m "Refactor the auth module"

# Point at a specific project
stigmer run agent refactorer --workspace ~/projects/acme-backend -m "Clean up dead code"
```

**Session YAML:**
```yaml
spec:
  workspace_source:
    local_path:
      path: "/Users/dev/projects/acme-backend"
```

**Constraints and behavior:**

| | |
|---|---|
| Mode | Local mode only. Cloud runners reject `local_path` at provisioning time with a clear, actionable error. |
| No copy | The agent operates on the real directory. There is no intermediate copy or upload. |
| Live changes | File changes are visible immediately — in your editor, in git status, everywhere. |
| Path resolution | The CLI expands `~` and resolves relative paths to absolute before sending to the backend. `.` becomes the full absolute path of your current directory. |
| Validation | The CLI verifies the path exists and is a directory before creating the session. |

---

## The End-to-End Flow

This is how workspace provisioning works from the moment you type `stigmer run` to the moment the agent receives its first message.

```
                        ┌─────────────────────────────────────────────────────┐
                        │  CLI  (stigmer run agent)                           │
                        │                                                     │
                        │  1. Parse --workspace / --branch / --commit flags   │
                        │     parseWorkspaceSource() → WorkspaceSource proto  │
                        │                                                     │
                        │  2. Explicit session creation                       │
                        │     createSessionForAgent()                         │
                        │     Session.spec.workspace_source = WorkspaceSource │
                        │                                                     │
                        │  3. Create AgentExecution                           │
                        │     AgentExecution.spec.session_id = session.id     │
                        └─────────────────┬───────────────────────────────────┘
                                          │  gRPC
                        ┌─────────────────▼───────────────────────────────────┐
                        │  Backend API                                        │
                        │                                                     │
                        │  Stores Session with workspace_source               │
                        │  Stores AgentExecution → enqueues Temporal task     │
                        └─────────────────┬───────────────────────────────────┘
                                          │  Temporal workflow
                        ┌─────────────────▼───────────────────────────────────┐
                        │  Agent Runner  (execute_graphton.py)                │
                        │                                                     │
                        │  4. Initialize workspace backend                    │
                        │     Local mode  → LocalWorkspaceBackend(tmpdir)     │
                        │     Cloud mode  → DaytonaWorkspaceBackend(sandbox)  │
                        │                                                     │
                        │  5. Workspace provisioning                          │
                        │     WorkspaceProvisioner.provision()                │
                        │     ├─ git_repo   → git clone (with token)         │
                        │     ├─ local_path → validate + mount               │
                        │     └─ (absent)   → empty scratch directory        │
                        │                                                     │
                        │  6. Credential strip                                │
                        │     consumed_keys removed from merged env           │
                        │     (GITHUB_TOKEN never reaches agent runtime)      │
                        │                                                     │
                        │  7. System prompt assembly                          │
                        │     "## Workspace" section injected                 │
                        │     workspace_description from ProvisionResult      │
                        │                                                     │
                        │  8. Agent execution begins                          │
                        │     Agent reads/writes files at root_dir            │
                        └─────────────────────────────────────────────────────┘
```

### Step-by-Step Breakdown

**Step 1 — CLI flag parsing**

`parseWorkspaceSource()` converts `--workspace`, `--branch`, and `--commit` into a `WorkspaceSource` proto message. It detects the source type automatically:

- Value starts with `https://` → `GitRepoSource`
- Value starts with `git@` → rejected with a helpful SSH error
- Anything else → treated as a local path, resolved to absolute, validated to exist

**Step 2 — Explicit session creation**

When a workspace is requested, the CLI creates the Session itself via `createSessionForAgent()`, setting `workspace_source` on the `SessionSpec`. Without a workspace, the backend auto-creates the session — a flow that has no mechanism to forward workspace configuration. By creating the session explicitly, the CLI stays in control of the workspace contract.

**Step 3 — AgentExecution linked to the session**

The execution is created with `session_id` pointing to the pre-created session. The backend infers the agent from the session. No workspace configuration appears on the execution itself — workspace is a session concern, not an execution concern.

**Steps 4–5 — Backend provisioning**

The agent runner receives the Temporal task, reads `session.spec.workspace_source`, and dispatches to the appropriate source handler:

| Source | What happens |
|---|---|
| `git_repo` | Clones the repo at the specified URL, branch, and commit. Token injected into clone URL, scrubbed from all log messages. |
| `local_path` | Validates the path exists. In local mode, the workspace backend root is set to that path. In cloud mode, returns a clear error. |
| absent | Returns the existing empty sandbox/tmpdir root. No provisioning step. |

The result is a `ProvisionResult` with four fields the rest of the pipeline reads:
- `root_dir` — the authoritative workspace root the agent writes to
- `workspace_description` — a human-readable summary for the system prompt
- `consumed_keys` — environment variable names to strip before agent startup
- `git_metadata` — branch, commit SHA, remote URL (git source only)

**Step 6 — Credential strip**

Every key in `consumed_keys` is deleted from the merged environment before the agent starts. The agent runtime never receives the provisioning credentials. This is AD-05: credential isolation at the provisioning boundary.

**Step 7 — System prompt injection**

A `## Workspace` section is inserted into the system prompt, between the agent's base instructions and its skills. The content comes from `workspace_description` and is tailored to the source type:

- **Git repo**: repo URL, branch, HEAD commit SHA, a note that file changes are not automatically committed
- **Local path**: absolute path, a warning that the agent is operating directly on the user's files
- **Empty**: no section added

**Step 8 — Agent execution**

The agent starts with `root_dir` as its working directory. It can read any file in the workspace, create new files, modify existing ones, and call tools that operate on paths within the workspace.

---

## Workspace-Aware File Attachments

When you use `--attach` alongside `--workspace`, Stigmer automatically determines whether each attached file is inside or outside the workspace — and handles each case optimally.

```bash
stigmer run agent code-reviewer \
  --workspace . \
  --attach ./src/auth/login.go \
  --attach ./docs/external-api-spec.pdf \
  -m "Review the login implementation against the API spec"
```

In this example:
- `./src/auth/login.go` is **inside** the workspace — it is already accessible to the agent at its real path. No upload. No copy. The agent is told to read `src/auth/login.go` directly from the workspace.
- `./docs/external-api-spec.pdf` is **outside** the workspace — it is uploaded to object storage and injected into the agent's `.stigmer/inputs/` directory.

### Why This Matters

Without workspace awareness, every attached file would be uploaded and copied to a staging directory — even files the agent could already read from the workspace. This creates:

- Redundant uploads for files already accessible
- Confusing duplicates: `src/auth/login.go` and `.stigmer/inputs/login.go` referring to the same file
- Misleading system prompt text telling the agent a file is "not part of the project source tree" when it plainly is

With workspace awareness, the system is truthful: inside-workspace files are referenced by their real workspace-relative paths, and the agent reads from the same file the user edited.

### The Split

| File location | What happens | How agent sees it |
|---|---|---|
| Inside workspace | Recorded as `workspace_file_refs` (workspace-relative path). No upload. | `## Referenced Files` section listing real paths |
| Outside workspace | Uploaded to R2, injected as attachment | `## Input Files` section, copied to `.stigmer/inputs/` |

Both can occur in the same execution. Mixed scenarios — some files inside, some outside — are handled automatically.

> **Note:** Workspace file referencing only applies when `--workspace` is a local path (`LocalPathSource`). When using a git repo source (`GitRepoSource`), the workspace is on a remote runner — the CLI cannot know the runner's filesystem, so all `--attach` paths are uploaded normally.

---

## How the Agent Sees the Workspace

The agent receives its workspace context through two mechanisms.

### 1. The `## Workspace` System Prompt Section

Every execution in a provisioned workspace includes a `## Workspace` section in the system prompt. This section is positioned directly after the agent's base instructions and before its skills:

```
[Agent base instructions]

## Workspace
[workspace description from ProvisionResult]

## Available Skills
[injected skill content]

## Referenced Files
[workspace file references, if any]

## Input Files
[uploaded attachments, if any]
```

The content of `## Workspace` depends on the source:

**Git repo workspace:**
```
You are working in a cloned git repository.
- Remote: https://github.com/acme/backend.git
- Branch: feature/auth-refactor
- HEAD: a1b2c3d4e5f6789...

The workspace contains the full repository tree as of this commit.
File changes you make are not automatically committed or pushed — if
you want to capture your work, write a diff or ask the user to commit.
Start by listing the root directory to orient yourself.
```

**Local path workspace:**
```
You are operating directly on the user's local filesystem.
- Path: /Users/dev/projects/acme-backend

IMPORTANT: Changes you make are immediate and permanent. There is no
undo. The user's files will be modified in place. Confirm destructive
changes with the user before proceeding.
```

### 2. `## Referenced Files`

When workspace file references are present (files attached via `--attach` that are inside the workspace), a `## Referenced Files` section lists each file with its workspace-relative path and size, and instructs the agent to read directly from the workspace rather than a copy.

---

## Security Model

Workspace provisioning is designed around a single principle: **credentials used for provisioning must never reach the agent runtime.**

### Credential Isolation (AD-05)

When cloning a private repository, Stigmer needs a `GITHUB_TOKEN`. But an agent that receives a `GITHUB_TOKEN` in its environment could use it to make arbitrary GitHub API calls — outside the scope of what the user authorized.

The solution: the provisioner reads the token from the merged environment, uses it to construct the authenticated clone URL, and then strips it before the agent starts. The key names to strip are returned in `ProvisionResult.consumed_keys`. The agent runner deletes every key in this list from `merged_env_vars` before passing the environment to the agent.

```
Merged environment (Agent defaults + Instance env + Runtime env)
         │
         ▼
WorkspaceProvisioner.provision()
  → reads GITHUB_TOKEN
  → constructs https://<token>@github.com/acme/backend.git
  → git clone
  → returns consumed_keys: ["GITHUB_TOKEN"]
         │
         ▼
Agent runner strips consumed_keys from merged_env_vars
         │
         ▼
Agent runtime
  → no GITHUB_TOKEN in environment
  → cannot make unauthenticated or authenticated GitHub calls
    beyond what its MCP servers explicitly provide
```

Token scrubbing also applies to error messages: if the clone fails, the token value is replaced with `***` in every error string before it surfaces to logs or the user.

### No Copies for Local Paths

`LocalPathSource` makes no copy of your files. The agent operates directly on the real directory. This is both a feature (live changes, no sync lag) and a constraint (the agent can modify or delete files). The system prompt `## Workspace` section includes a visible warning about this when operating in local path mode.

### Cloud Rejection of Local Paths

`LocalPathSource` is only valid when the agent-runner is on the same machine as the path. Cloud runners reject it at provisioning time with a clear error — not silently, and not by trying to access a path that does not exist on the cloud machine. This is the same pattern used for SSH URL rejection in `GitRepoSource`: invalid deployment-specific configurations are caught at the boundary where they are meaningless, with an actionable error message.

---

## How It Compares

| Without `--workspace` | With `--workspace` |
|---|---|
| Agent starts in empty scratch directory | Agent starts with full repository or local project tree |
| You select and upload relevant files before running | Agent can browse, read, and modify any file in the workspace |
| Uploaded files are copies; agent modifications come back as artifacts to apply manually | Git workspace: agent writes to the clone; Local workspace: agent edits your files directly |
| Each execution starts from scratch | Workspace state persists across all executions in the session |
| `GITHUB_TOKEN` in environment is available to the agent | `GITHUB_TOKEN` used for cloning is stripped before agent starts |
| `--attach` always uploads, even for files already accessible | `--attach` detects workspace containment; inside-workspace files are referenced, not uploaded |
| Agent system prompt has no filesystem context | Agent receives a `## Workspace` section describing its environment |

---

## Getting Started

### Run an Agent on a GitHub Repository

```bash
# Clone the default branch, shallow (depth 1)
stigmer run agent code-reviewer \
  --workspace https://github.com/acme/backend.git \
  -m "Review the codebase for security issues and add findings to a report"
```

For a private repository, set `GITHUB_TOKEN` in your environment or a `.env` file:

```bash
GITHUB_TOKEN=ghp_... stigmer run agent code-reviewer \
  --workspace https://github.com/acme/private-backend.git \
  --branch main \
  -m "Audit authentication flows"
```

### Run an Agent on Your Local Project

```bash
# Point at the current directory
cd ~/projects/acme-backend
stigmer run agent refactorer \
  --workspace . \
  -m "Refactor the UserService to use the repository pattern"
```

The agent modifies your files directly. Review changes with `git diff` after the execution completes.

### Attach Specific Files Alongside a Workspace

```bash
# The agent reads login.go from the workspace (no upload)
# and receives external-spec.pdf as an uploaded attachment
stigmer run agent code-reviewer \
  --workspace . \
  --attach ./src/auth/login.go \
  --attach ~/Downloads/external-api-spec.pdf \
  -m "Review login.go against the external API spec"
```

### Pin to a Specific Commit

```bash
stigmer run agent auditor \
  --workspace https://github.com/acme/backend.git \
  --branch main \
  --commit a1b2c3d4e5f6789abcdef \
  -m "Audit the state of the codebase as of this release commit"
```

---

## Further Reading

- [What is a Session?](what-is-session.md) — Session lifetime, workspace persistence across executions, YAML schema for `workspace_source`
- [What is an Agent Runner?](what-is-agent-runner.md) — How the provisioner, workspace backend, and execution environment work together
- [Workspace Proto Schema](../../apis/ai/stigmer/agentic/session/v1/workspace.proto) — `WorkspaceSource`, `GitRepoSource`, and `LocalPathSource` field definitions
