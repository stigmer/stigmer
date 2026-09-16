---
name: create-stigmer-oss-pull-request
description:
  Writes a pull request title and description from the branch's commits and
  diff, then pushes the branch and opens the pull request with the GitHub CLI.
  Invoke by name to open a PR, or to draft only the title and body without
  opening one.
disable-model-invocation: true
---

# Create a Stigmer OSS pull request

Two modes, one procedure. Asked for the title and body only, produce the two
blocks below and change nothing. Asked to open the PR, produce them, push, and
run `gh pr create` from the worktree, non-interactively; if a prerequisite is
missing (`gh` not installed or not authenticated), stop with the command that
fixes it.

## Preconditions

- The branch already exists: work happens in a git worktree that owns it, so
  there is no branch to create here. Commits come from
  `.agents/skills/commit-stigmer-oss-changes/SKILL.md`; uncommitted changes are
  committed there first or left out deliberately.
- `gh auth status` succeeds and `origin` is writable.
- Base branch: `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`,
  falling back to `main`.
- One pull request per branch. If `gh pr list --head <branch>` finds one, push
  and stop; never open a second.

## Read the branch before writing

```bash
git log --oneline origin/main..HEAD
git diff --name-status origin/main...HEAD
git diff --stat origin/main...HEAD
```

The commits say what changed and why; the file list decides the scope.

## The title

One line, in a fenced `text` block when drafting:

```text
<type>(<scope>): <imperative summary>
```

`<type>` is one of `feat`, `fix`, `refactor`, `docs`, `test`, `perf`, `ci`,
`build`, `chore`, `revert`; `<scope>` follows the scope rule in the commit skill
(the most affected area from the repository map, path-like, `repo` for
repository-wide changes); the summary is imperative, specific, at most 72
characters after the prefix, no trailing period.

## The body

A fenced `markdown` block when drafting. Use the sections that apply and omit
the rest:

```markdown
## Summary

<one to three sentences in plain language>

## Context

<the problem, bug or goal that made the change necessary>

## Changes

- <key change, grouped by area when several>

## Implementation notes

- <a decision or trade-off a reviewer should know>

## Breaking changes

- <what breaks and how to migrate, or "None">

## Test plan

- <the checks that ran, with their summary lines; manual steps; screenshots>

## Risks

- <what could go wrong and how to roll back>

Closes #<issue>
```

The test plan quotes evidence, not intentions: the summary line of each check
that ran, as the root guide's verification map asks. A PR that fixes an issue
carries `Closes #N` in the body, where it survives a squash merge.

## Opening it

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --title "$TITLE" --body "$BODY" [--draft] [--reviewer ...] [--label ...]
```

Open as a draft when the work is a milestone of a longer program that will grow
on the same branch. Report the PR URL. Merging is a separate, explicitly
requested act, never part of opening.
