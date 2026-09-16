---
name: wrap-up-github-issue
description:
  Wraps up a GitHub issue whose fix is in a pull request that has not merged,
  wiring the auto-close keyword, posting a comment that says what was done and
  credits the reporter, and labelling the issue in progress without closing it.
  Invoke by name at session wrap-up, as in "wrap up issue 248".
disable-model-invocation: true
---

# Wrap up a GitHub issue

For an issue whose fix exists but has not merged. The issue stays open and
closes itself when the pull request merges to `main`; this procedure makes that
linkage certain and tells the reporter what happened. Closing an issue whose fix
has already shipped is a different act and is not done here.

Issues live in the stigmer/stigmer repository on GitHub; pass
`--repo stigmer/stigmer` to every `gh` call so the procedure works from any
directory.

## 1. Gather

- The issue number from the user.
- The fix's pull request:
  `gh pr list --repo stigmer/stigmer --head <branch> --json number,url,body,state`;
  if none exists yet, the branch or commit that carries the fix.
- The reporter and their suggestions:
  `gh issue view N --repo stigmer/stigmer --json title,author,body,comments,state,labels`.
  If the issue is already closed, report that and stop.

## 2. Wire the auto-close

GitHub closes an issue when a pull request whose body or title carries
`Closes #N` (or `Fixes`, `Resolves`) merges to the default branch. The keyword
must be in the PR body: under a squash merge, commit footers do not survive.

- PR exists without the keyword: append it to the body with `gh pr edit`.
- No PR yet: put `Closes #N` in the fix commit's footer now, and when the PR is
  opened (`.agents/skills/create-stigmer-oss-pull-request/SKILL.md`) confirm the
  body carries it.
- Never `gh issue close` here; the merge does it.

## 3. The comment

Draft, show for approval, then post with
`gh issue comment N --repo stigmer/stigmer --body "..."`. The comment:

1. States what was done, with the PR link.
2. Says the issue stays open and closes automatically when the PR merges.
3. Says the fix ships in the next Stigmer release.
4. Addresses the reporter's suggestions, naming which were taken, which were
   deferred and why, and thanks them for the specific thing they contributed
   (the report, the analysis, the reproduction). A thoughtful report earns a
   thoughtful reply.

```markdown
Fixed in #<PR>. Leaving this open; it will **close automatically when #<PR>
merges to `main`** and ships in the next Stigmer release.

### What's fixed

- <the change and where it lives>

<What was taken from the reporter's suggestions, what was deferred and why.>
Thanks @<reporter> for <the specific contribution>.
```

## 4. Label

`gh issue edit N --repo stigmer/stigmer --add-label "status: in-progress"`. Keep
the existing type, component and priority labels. Do not add the to-be-deployed
status here; that belongs to the flow that runs after merge.

## Report

The issue URL, the PR URL, and confirmation that the auto-close keyword is in
the PR body.
