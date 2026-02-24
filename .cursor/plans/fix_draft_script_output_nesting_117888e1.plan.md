---
name: Fix draft script output nesting
overview: Fix the double-nesting issue in `02_draft_agent_creator.sh` by aligning its output directory handling with the pattern established by `01_vendor_skill.sh` -- point at the parent `skills/` directory and do targeted cleanup of only the `agent-creator` subdirectory.
todos:
  - id: fix-script
    content: "Update `02_draft_agent_creator.sh`: rename OUTPUT_DIR to SKILLS_DIR, point at `skills/`, targeted cleanup of `agent-creator` only, update echo lines"
    status: completed
  - id: relocate-files
    content: Delete the incorrectly nested `skills/agent-creator/agent-creator/` directory so the tree is clean for the next script run
    status: completed
isProject: false
---

# Fix agent-creator draft script output nesting

## Problem

The CLI's `downloadDirectoryArtifact` always creates `filepath.Join(downloadDir, artifactName)`. The draft script passes `--output skills/agent-creator`, producing:

```
skills/agent-creator/agent-creator/SKILL.md   <-- broken (double nesting)
```

The desired structure is:

```
skills/agent-creator/SKILL.md                 <-- correct (flat)
```

The user can't just change the output to `skills/` because the script's `rm -rf "$OUTPUT_DIR"` would destroy the sibling `skill-creator/` directory.

## Root cause

In `[02_draft_agent_creator.sh](backend/services/stigmer-server/pkg/seedpack/tools/02_draft_agent_creator.sh)`, line 52:

```bash
readonly OUTPUT_DIR="${SEEDPACK_DIR}/skills/agent-creator"
```

This is one level too deep. The CLI adds the artifact name as a subdirectory automatically.

## Fix

Align with the pattern in `[01_vendor_skill.sh](backend/services/stigmer-server/pkg/seedpack/tools/01_vendor_skill.sh)` which correctly uses `SKILLS_DIR="${SEEDPACK_DIR}/skills"` and does targeted cleanup (`rm -rf "$dest_dir"` where `dest_dir="${SKILLS_DIR}/${skill_name}"`).

### Changes to `02_draft_agent_creator.sh`

- Rename `OUTPUT_DIR` to `SKILLS_DIR` (matching vendor script naming) and point it at `${SEEDPACK_DIR}/skills`
- Replace the blanket `rm -rf "$OUTPUT_DIR"` + `mkdir -p "$OUTPUT_DIR"` with a targeted `rm -rf "${SKILLS_DIR}/agent-creator"` (only cleans the specific skill, preserving `skill-creator` and any future siblings)
- Pass `--output "${SKILLS_DIR}"` to the CLI
- Update the echo/log lines to reflect the new paths

### Relocate existing files

- Delete the incorrectly nested `skills/agent-creator/agent-creator/` directory
- The files currently there are untracked (per `git status`), so this is safe
- After the script is fixed, re-running it will produce files at the correct location

No changes needed to:

- The CLI code (`run_handlers.go`) -- its behavior is correct by design
- `seedpack.go` -- `LoadSkillContent("skills/agent-creator")` will work once files are at the right level
- `embed.go` -- the `//go:embed skills` directive already embeds all subdirectories recursively

