---
name: commit-stigmer-oss-changes
description:
  Commits the session's changes in this repository with a Conventional Commits
  message whose scope comes from the changed paths, after the verification
  procedure has run green. Invoke by name when the work is ready to commit.
disable-model-invocation: true
---

# Commit Stigmer OSS changes

## Before the commit

1. Run `.agents/skills/verify-stigmer-oss-changes/SKILL.md`. A newly introduced
   failure stops here; show it and do not commit. Pre-existing findings in
   untouched files are named and do not block.
2. `git status` and the conversation decide what belongs in this commit. Stage
   by explicit path (`git add <path> ...`), never `git add -A`: a worktree
   accumulates build output, generated docs and stray files that are not this
   change, and a commit is reviewed as a unit of intent.
3. Nothing from a private planning tree is committed here. This repository is
   public and tracks only its own code, docs and guidance; planning records,
   changelogs and session notes live with the maintainers elsewhere and are
   git-ignored here. Never re-add an ignored folder.

## The message

Conventional Commits:

```text
<type>(<scope>): <subject>

<body, optional>

<footer, optional>
```

**Type**: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `style`,
`ci`, `build`, `revert`.

**Scope** follows the repository map in the root `AGENTS.md`, as a path-like
token for the most affected area. A change across several areas takes the
broader scope or none.

```text
apis                 apis/<resource> for one resource
backend/stigmer-server   backend/runner   backend/libs
sdk                  sdk/react, sdk/theme, sdk/go, ... for one package
client-apps/cli      client-apps/web   client-apps/desktop
mcp-server           test/conformance  test/e2e
docs   site   demos  deploy   scripts
agents               guidance files (AGENTS.md, .agents/)
repo                 repository-wide configuration
```

**Subject**: imperative mood, no trailing period, under 72 characters, specific.

**Body** when the change needs a why: wrap at 72 columns, explain what and why
rather than how, one bullet per distinct change when there are several, and cite
the issue or the PR the reasoning traces to. Comments in the code state intent;
the body states the intent of the change.

**Footer**: `BREAKING CHANGE:` when behaviour breaks; `Closes #N` when the
change fixes an issue (the PR body must carry the same keyword to survive a
squash merge); `Co-authored-by:` for pair work.

## Executing

```bash
git add <path> [<path> ...]
git commit -m "<type>(<scope>): <subject>" [-m "<body>"]
```

- Show the proposed message before committing when the change is significant.
- Never `--no-verify`: the pre-commit hook formats guidance and docs and runs
  the docs linter; a hook failure is information.
- Confirm with `git log --oneline -1` and report the hash.
