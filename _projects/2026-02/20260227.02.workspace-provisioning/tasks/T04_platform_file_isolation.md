# Phase 4: Platform-File Isolation

## Problem Statement

The platform currently writes two categories of "platform files" into the workspace root directory:

1. **Skills** (`bin/skills/{name}/SKILL.md`, `bin/skills/{name}/...`) — Written by `skill_writer.py` so the agent can read them on demand.
2. **Input files** (`.stigmer-inputs/{filename}`) — Written by `inject_attachments()` so the agent can read user-provided context files.

For `git_repo` workspaces, this is partially addressed: the cloned repo is a copy, and `.git/info/exclude` hides platform files from `git status` and `git diff`. But the files are still physically inside the workspace tree.

For `local_path` workspaces, this is a real problem: **platform files get written directly into the user's project directory.** The user points their workspace at `/Users/dev/my-project`, and suddenly `bin/skills/` and `.stigmer-inputs/` appear in their project. If the directory is a git repo (which it likely is), these show up as untracked files, can accidentally get committed, and pollute the working tree.

For `empty` workspaces, it's not a problem (temp directory, nobody cares), but the inconsistency is undesirable.

## Why This Matters

The user explicitly stated: *"I don't want the band-aid route. These file system modifications are the core, and if that is working perfectly, then I know we will make wonders."*

This is a foundational filesystem architecture decision. Getting it right means:
- Clean separation between "the user's code" and "the platform's operational files"
- No workspace type has platform pollution
- The agent can still read skills and inputs via its tools
- The solution works identically across local and cloud (Daytona) modes

## Current Architecture

```
workspace_root/                  ← WorkspaceBackend.root_dir
├── .git/                        ← Only for git_repo sources
├── bin/skills/                  ← PLATFORM: written by skill_writer.py
│   ├── skill-a/SKILL.md
│   └── skill-b/SKILL.md
├── .stigmer-inputs/             ← PLATFORM: written by inject_attachments()
│   ├── requirements.pdf
│   └── design-spec.md
├── src/                         ← USER: project source code
├── README.md                    ← USER: project files
└── ...
```

## Desired Architecture

Platform files should live **outside** the workspace root, in a sibling or parent-level directory that the agent can still access but that is clearly not part of the user's project.

### Design Considerations

1. **Agent tool access**: The agent uses `read`, `glob`, `grep`, etc. These tools operate relative to `WorkspaceBackend.root_dir`. If platform files are outside `root_dir`, the agent needs a way to reach them. The backend's path-traversal protection (`../` raises `ValueError`) currently prevents this.

2. **System prompt paths**: The system prompt tells the agent where skills and inputs are. Currently paths like `bin/skills/my-skill/SKILL.md` are relative to workspace root. If files move, the system prompt must reflect the new paths.

3. **WorkspaceBackend boundary**: The backend enforces that all paths are within `root_dir`. Moving platform files outside means either:
   - Expanding the backend's scope (e.g., a "session root" that contains both workspace and platform dirs)
   - Giving the agent a second backend or path-scope for platform files
   - Mounting platform files into the workspace via symlinks

4. **Daytona compatibility**: In cloud mode, the workspace is inside a Daytona sandbox. The "session root" concept must work within the sandbox filesystem.

5. **Idempotency**: Skills and inputs must survive across executions in the same session (Daytona volume persistence). The solution must not break resume-after-approval fast-paths.

6. **Git diff artifact**: `_generate_git_diff_artifact()` currently excludes `.stigmer-inputs` and `bin/skills` via pathspec. If platform files move out, the pathspec exclusions become unnecessary (cleaner).

### Possible Approaches (to explore in planning)

**A. Session-root container**: A parent directory (`session_root/`) containing `workspace/` (the user's code) and `platform/` (skills, inputs). The `WorkspaceBackend.root_dir` stays pointed at `session_root/workspace/`. Platform files go to `session_root/platform/`. The agent gets system-prompt paths like `../platform/skills/...`. But path-traversal protection blocks `../`.

**B. Expanded backend scope**: Change `WorkspaceBackend.root_dir` to the session root, and tell the agent "your project is in `workspace/`". Skills at `platform/skills/`, inputs at `platform/inputs/`. All paths relative to the session root. But this changes the agent's working model ("my files are in `workspace/`" vs "my files are at the root").

**C. Symlink bridge**: Keep platform files in a sibling directory but symlink them into the workspace. The agent sees `bin/skills/` as a symlink. No path-traversal issues. But symlinks in Daytona sandboxes need validation. And for `local_path` mode, creating symlinks in the user's directory is still invasive.

**D. Dual-scope backend**: The agent gets two path scopes — one for workspace (read/write, the user's code) and one for platform (read-only, skills/inputs). The system prompt tells the agent which scope holds what. The backend protocol would need extension.

**E. Virtual filesystem overlay**: Platform files are served via a different mechanism entirely (e.g., the agent's tool responses include skill content directly, rather than the agent reading files). This eliminates filesystem placement entirely but changes the skill activation model.

## Constraints

- Must work across both `LocalWorkspaceBackend` and `DaytonaWorkspaceBackend`
- Must not break the resume-after-approval fast-path (skills/inputs persist across executions)
- Must work for all three source types: `git_repo`, `local_path`, `empty`
- Must not require the agent to understand deployment topology (deployment-agnostic)
- The skill activation model (agent reads `SKILL.md` on demand) should be preserved unless there's a compelling reason to change it

## Out of Scope for Phase 4

- Workspace awareness in system prompt (Phase 5)
- Local-mode input file optimization / `Attachment.local_path` (Phase 6)
- Proto changes for `SessionStatus` / `workspace_state` (tech debt, separate project)

## Entry Points for Analysis

- `backend/services/agent-runner/worker/activities/graphton/skill_writer.py` — How skills are written
- `backend/services/agent-runner/worker/activities/execute_graphton.py` → `inject_attachments()` — How inputs are placed
- `backend/services/agent-runner/worker/workspace/backend.py` — `WorkspaceBackend` protocol, path safety
- `backend/services/agent-runner/worker/workspace/local.py` — `LocalWorkspaceBackend._safe_path()` (traversal guard)
- `backend/services/agent-runner/worker/workspace/__init__.py` → `initialize_workspace()` — Where the session root is determined
