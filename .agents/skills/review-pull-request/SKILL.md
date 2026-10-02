---
name: review-pull-request
description:
  Has a pull request read cold by a reviewer that did not write it, a fresh
  subagent given only the pull request and this brief, and posts its verdict as
  the comment the Review verdict check and the merge require. Invoke by name, or
  from the pull-request and merge skills, once a pull request is open and its
  checks pass.
disable-model-invocation: true
---

# Review a pull request

Every pull request is read, before it merges, by a reviewer that did not write
it. The author knows what the change was meant to do; the reviewer reads what it
does. Its verdict is a comment on the pull request, and
`scripts/review-verdict.mjs` is the only thing that writes one: `approve` or
`changes-needed`, bound to the change and the body's declarations. The script's
header has the rules. The `Review verdict` check (`ci.review.yaml`) requires a
current `approve`; a repository without that check can hold its merges to the
same verdict by importing `readReview` from a copy of the script. The copy needs
`scripts/test-integrity.mjs` beside it, at the same commit: the verdict imports
the declaration grammar from there, so a review binds exactly the declarations
the integrity check reads.

The session that owns the pull request runs this at the end of its verification,
so a `changes-needed` is fixed before anyone is asked to merge. Whoever arms the
merge runs it again only when the verdict is missing or stale.

## Procedure

1. **Is a review needed?** From a checkout of the pull request's base branch at
   its tip (the primary checkout, pulled), never the pull request's own
   worktree: the check computes the digest with the base's copy of the script,
   and a pull request that changes the script would otherwise post a digest the
   check never matches.

   ```bash
   node scripts/review-verdict.mjs --status -R <owner/repo> <n> --json
   ```

   `current` needs nothing more. Any other state needs a review: keep the `head`
   and `digest` it printed. They are what the reviewer will read, and step 4
   posts the verdict only if neither has moved. A repository that carries a copy
   of the script runs its own copy. To judge a pull request of another
   repository, pass `--dir <a checkout of its base>`.

2. **Give the reviewer a checkout at the head.** This is the pull request's
   worktree when it is clean and its `HEAD` is the head
   (`gh pr view <n> -R <owner/repo> --json headRefOid`). Otherwise use a
   detached worktree made for the review and removed after:
   `git worktree add --detach <path> <head>`, after `git fetch origin <head>`.

3. **Launch the reviewer in a fresh context:** a subagent that starts from
   nothing but its prompt. In Claude Code that is the `general-purpose` agent,
   never a fork; in Cursor, a subagent. It runs on the session's main model:
   launch it with no model override, and in Claude Code with no default subagent
   model configured, since an agent launched without an override takes that
   default. Pass the prompt below verbatim, with its five placeholders filled
   and nothing added. A sentence about what the change is for steers the review
   toward the author's reading, which is what the review exists to avoid.

   ```text
   You are reviewing pull request {number} of {repo}, at head commit {head}.
   You did not write it, and you have no context beyond this message.
   A checkout at that head is at {checkout}.

   Read the brief in {brief}, the section "What the reviewer does", and follow
   it exactly. Do not edit any file, push, comment on or merge anything. Your
   last message is the JSON object the brief describes, and nothing else.
   ```

   `{brief}` is this file's absolute path: stigmer's
   `.agents/skills/review-pull-request/SKILL.md` in a local checkout of stigmer.

4. **Post the verdict.** Save the reviewer's JSON to a file outside the tree,
   then, from the same checkout of the base as step 1:

   ```bash
   node scripts/review-verdict.mjs --write -R <owner/repo> <n> --verdict-file <file> --reviewed-head <head> --reviewed-digest <digest>
   ```

   It refuses a verdict whose head, change or declarations moved since step 1 (a
   declaration added during the review would otherwise be approved unread), or
   whose shape is wrong (an `approve` with a blocking finding, for one). It
   posts the comment and, on a repository with `ci.review.yaml`, reruns the
   check so that it reads the comment. Never write a review comment by hand, and
   never post a verdict the reviewer did not give.

   Post every verdict the reviewer gives, as soon as it arrives and before you
   act on any finding (an armed merge is disarmed first when you mean to
   supersede an `approve`, step 5): an `approve` you are about to supersede by
   fixing its minor findings, and every `changes-needed`. The comments are the
   only record of what each reviewer found, and a verdict fixed without being
   posted is lost to everyone who later asks what the reviews catch. A verdict
   the script refuses, because the change moved during the review or because the
   verdict's shape is wrong, cannot be posted: have the change read again by a
   new reviewer.

5. **Act on it.** On `approve`, the pull request is ready for its merge. On
   `changes-needed`, fix each blocking finding, verify, push, and run this
   procedure again with a new reviewer; a reviewer that saw its own earlier
   findings is no longer fresh. A finding you judge wrong is answered in a reply
   on the pull request, with the reason, and the next reviewer reads that reply
   with everything else. After an `approve`, you may still fix its minor
   findings: disarm an armed merge first
   (`gh pr merge <n> -R <owner/repo> --disable-auto`), post the approve, push
   the fixes, and run this procedure again with a new reviewer; arm the merge
   only on that review's `approve`.

## What the reviewer does

You are reading a pull request you did not write. Your job is to find what is
wrong with it before it merges. Assume there is something to find, and do not
stop at the first finding.

**Read, in this order:**

1. The change: `git diff $(git merge-base origin/<base> HEAD) HEAD` in the
   checkout, with the base from `gh pr view <n> -R <repo> --json baseRefName`.
2. The pull request's body (`gh pr view <n> -R <repo> --json body`). Its claims
   are to be checked, not trusted. The test plan quotes each check's summary
   line; `Verify at train` lists what only production can show.
3. Each declaration in the body (`Test-removal:`, `Quarantine:`, `Skip:`,
   `RPC-waiver:`, `Coverage-drop:`), and the integrity tool's report of the
   change:
   `node scripts/test-integrity.mjs --base origin/<base> --pr-body-file <the body saved to a file>`.
   Its `retitled` lines are cases whose titles changed. A retitle is also how a
   real case gets swapped for a trivial one, so read each pair.
4. The code the change depends on and the code that depends on it, as far as you
   need to judge a hunk: the callers of a changed function, the guide
   (`AGENTS.md`) and README of each package touched, and the tests beside it.

**Judge:**

- **Correctness at the boundaries.** Empty and missing inputs, errors and their
  exact messages, concurrency, and what happens on the second run. Behaviour a
  caller relies on that the change alters without saying so.
- **The tests.** Answer the questions before "done" in
  `.agents/skills/conformance-test-authoring/references/test-discipline.md` for
  this change. The red flags in that file are findings.
- **Security.** Answer each question in
  [../review-change-security/SKILL.md](../review-change-security/SKILL.md) that
  the change touches, and report as that file says. The `security` field of your
  answer is never empty.
- **Each declaration.** Is the removal, quarantine or skip justified by its
  reason, and does a quarantine name an open issue? For a lowered coverage
  floor: is its cause real (tests removed or moved, a library that reaches the
  code through other paths, code no test can reach), and is the new floor the
  `• measured` figure in the `Coverage` report less the floors file's margin,
  and no lower? The report rounds that figure to the nearest tenth while a floor
  rounds down, so a floor up to 0.1 below it is the same figure. A floor removed
  with its package (deleted, or renamed, when the new directory enters with its
  own entry) has no new figure, and its reason names the move. An unjustified
  declaration is a blocking finding.
- **Each line switched off.** A comment the diff adds that turns a check off for
  a line (above all a coverage ignore hint: `v8 ignore`, `c8 ignore`,
  `istanbul ignore`) is judged like a skip, and its reason must be true. A hint
  over a line a test could reach is a blocking finding, and so is one whose
  reason describes something other than the line it hides.
- **The claims.** Does the diff do what the body says, and does the test plan
  quote checks that cover the changed paths?
- **The guides.** Does the change keep the laws of the root `AGENTS.md` and of
  each touched package's guide?
- **The gate itself.** A change to `.github/workflows/ci.review.yaml`,
  `scripts/review-verdict.mjs`, this brief, the security questions it links, any
  other required check's workflow, or the scripts and data `Gate` runs from the
  pull request's own tree (`scripts/test-coverage.mjs` and
  `test/coverage-floors.json` among them) judges its own pull request with the
  edited copy: GitHub takes a pull request's workflow from its merge commit, and
  that workflow runs the pull request's checkout. Read it as a change to what
  every later pull request must pass. A weakening the body does not name and
  justify is a blocking finding.
- **Nothing private in a public repository.** In stigmer, a diff, a comment or
  the body that names a private planning record, its folder or its task,
  decision, ruling or milestone ids is a blocking finding. A maintainer reads
  the reason in its own words, a PR or issue number, a SHA or a file.

**Severity.** A finding is `blocking` when the pull request must not merge with
it: a defect, a behaviour change without a test that proves it, an unjustified
declaration, a claim the diff contradicts, a broken law. A finding is `minor`
when it is worth fixing but the change is sound without the fix. The verdict is
`approve` exactly when no finding is blocking.

**Answer** with one JSON object as your last message and nothing after it:

```json
{
  "verdict": "approve",
  "reviewer": "<the model you run on>",
  "security": "none found (authorization, untrusted input)",
  "findings": [
    {
      "path": "backend/x.ts",
      "line": 42,
      "severity": "minor",
      "summary": "one line: what is wrong and why it matters"
    }
  ]
}
```

`findings` is empty when there are none. Each summary is one sentence a
maintainer can act on without asking you. `security` is `none found` followed by
the questions you read the change against, or the concern in one sentence.
