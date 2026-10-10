---
name: review-pull-request
description:
  Has a pull request read once in full by a fresh reviewer that did not write
  it, then every later push read by a narrow fix-check, and posts each verdict
  as a comment. Says when one is needed. Invoke by name, or from the
  pull-request and merge skills, once a pull request is open and its checks
  pass.
disable-model-invocation: true
---

# Review a pull request

A pull request is read, before it merges, by a reviewer that did not write it,
whenever the next section says a review is needed. The author knows what the
change was meant to do; the reviewer reads what it does. It gets **one** full
review. The author fixes what that review found, and every push after it gets a
**fix-check**: a fresh reader of only what the push changed, which answers each
open blocking finding `resolved` or `unresolved`, may flag what the fix itself
broke, and never starts a new review. A push that adds behaviour no finding
asked for is the one exception: the fix-check says `needs-review`, and the
change gets one new full review.

Each verdict is a comment on the pull request, and `scripts/review-verdict.mjs`
is the only thing that writes one: a review (`approve` or `changes-needed`) or a
fix-check (`resolved`, `unresolved` or `needs-review`), bound to the change and
the body's declarations. The script's header has the rules, the chain of
verdicts among them. The `Review verdict` check (`ci.review.yaml`) requires a
current verdict, an `approve` or a `resolved` fix-check after it, while `main`'s
ruleset requires that check; a repository without that check can hold its merges
to the same verdict by importing `readReview` from a copy of the script. The
copy needs `scripts/test-integrity.mjs` beside it, at the same commit: the
verdict imports the declaration grammar from there, so a verdict binds exactly
the declarations the integrity check reads.

The session that owns the pull request runs this at the end of its verification,
so a `changes-needed` is fixed before anyone is asked to merge. Whoever arms the
merge runs it again only when the verdict is not current, and step 1 says which
reading that needs.

## When a review is needed

`main`'s ruleset says. Read it for the pull request's repository:

```bash
gh api repos/stigmer/<repo>/rules/branches/main \
  --jq '{checks: [.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context], queue: any(.[]; .type == "merge_queue")}'
```

`checks` is what a merge needs; `queue` says whether a merge goes through the
merge queue, or arms `gh pr merge --auto --squash` and lands on its own head's
checks.

- **While `checks` lists `Review verdict`**, every pull request gets a review,
  run by the procedure below until its verdict is a current `approve`.
- **While it does not**, a stigmer pull request whose diff touches a security
  boundary below, or a file test rule 5 lists (`test/README.md`, "The rules
  every test keeps"), gets **one** round, by the same procedure. In that round:
  - each blocking finding about security, and each blocking finding under "The
    gate itself" below, is fixed, verified and pushed, with no second review;
    the push leaves the posted verdict stale, which is expected here and asks
    for no new round;
  - each other blocking finding is filed as an issue, linked in a reply on the
    pull request;
  - minor findings are left;
  - the verdict is posted as usual (step 4), as the record of what was found,
    even a `changes-needed`.

  Every other pull request gets none. The boundaries:
  - the server's `backend/services/stigmer-server/src/authorization`,
    `backend/services/stigmer-server/src/identity`,
    `backend/services/stigmer-server/src/runnerauth`,
    `backend/services/stigmer-server/src/platformtoken`,
    `backend/services/stigmer-server/src/encryption`,
    `backend/services/stigmer-server/src/sandbox`,
    `backend/services/stigmer-server/src/transport` and
    `backend/services/stigmer-server/src/pipeline`;
  - its domains `backend/services/stigmer-server/src/domain/apikey`,
    `backend/services/stigmer-server/src/domain/iampolicy`,
    `backend/services/stigmer-server/src/domain/identityaccount`,
    `backend/services/stigmer-server/src/domain/agentshare`,
    `backend/services/stigmer-server/src/domain/organization`,
    `backend/services/stigmer-server/src/domain/vault`,
    `backend/services/stigmer-server/src/domain/oauthapp`,
    `backend/services/stigmer-server/src/domain/platformclient`,
    `backend/services/stigmer-server/src/domain/mcpserver` and
    `backend/services/stigmer-server/src/domain/run/approval`;
  - the authorization model, `backend/services/stigmer-server/fga/model`;
  - the outbound guard, `backend/libs/ts/outbound`;
  - the runner's credential proxy, `backend/services/runner/src/agent-proxy`,
    and its guards in `backend/services/runner/src/shared`:
    `backend/services/runner/src/shared/approval-canonicalize.ts`,
    `backend/services/runner/src/shared/approval-fingerprint.ts`,
    `backend/services/runner/src/shared/approval-policy.ts`,
    `backend/services/runner/src/shared/cost-guard.ts`,
    `backend/services/runner/src/shared/llm-proxy.ts`,
    `backend/services/runner/src/shared/mcp-transport-guard.ts`,
    `backend/services/runner/src/shared/plan-mode-permissions.ts`,
    `backend/services/runner/src/shared/run-credential-store.ts`,
    `backend/services/runner/src/shared/run-credential.ts`,
    `backend/services/runner/src/shared/runner-credential-keys.ts`,
    `backend/services/runner/src/shared/runner-credential-store.ts` and
    `backend/services/runner/src/shared/shell-env.ts`;
  - the sandbox host, `crates/stigmer-runner-host`;
  - sign-in in the clients: `client-apps/web/src/auth`,
    `client-apps/web/src/app/auth`, `client-apps/web/src/app/oauth` and
    `client-apps/desktop/src/auth`;
  - the identity and vault APIs, `apis/ai/stigmer/iam` and
    `apis/ai/stigmer/agentic/vault`;
  - the RPC authorization posture:
    `apis/ai/stigmer/commons/rpc/authorization_config.proto`, and any diff that
    adds, removes or changes a method's authorization option in a proto under
    `apis`.

  Whether the diff touches one:

  ```bash
  gh pr diff <n> -R stigmer/stigmer --name-only
  ```

This section depends on the ruleset alone, so it stays true when the ruleset
changes again. A repository whose own guidance says otherwise follows that.

## Procedure

1. **Is a review needed?** First by the section above. Then, from a checkout of
   the pull request's base branch at its tip (the primary checkout, pulled),
   never the pull request's own worktree: the check computes the digest with the
   base's copy of the script, and a pull request that changes the script would
   otherwise post a digest the check never matches.

   ```bash
   node scripts/review-verdict.mjs --status -R <owner/repo> <n> --json
   ```

   The state says what to run:
   - `current`: nothing more.
   - `missing`: the one full review, steps 2, 3 and 4. It is missing when no
     review exists, or when a fix-check answered `needs-review`.
   - `stale`: a fix-check, steps 2, 3b and 4. A push moved the change past the
     newest verdict.
   - `changes-needed`: fix first (step 5), then a fix-check. A blocking finding
     is open on this exact change. A finding you judge wrong is answered in a
     reply, and the fix-check reads it, with or without a push.
   - `invalid`: a verdict does not parse or does not continue the chain. One new
     full review restarts the chain.

   Keep the `head` and `digest` it printed. They are what the reader will read,
   and step 4 posts the verdict only if neither has moved. For a fix-check, also
   keep `review.url` and `review.reviewed`: the verdict it continues. `open`
   lists the blocking findings it must answer. A repository that carries a copy
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

3b. **Launch the fix-check in a fresh context**, the same way as step 3: a
`general-purpose` agent on the session's main model, never a fork, never the
reviewer it follows. Pass this prompt verbatim, with its six placeholders filled
and nothing added; `{verdict}` is the `review.url` step 1 printed.

```text
You are fix-checking pull request {number} of {repo}, at head commit {head}.
You did not write it, and you have no context beyond this message.
A checkout at that head is at {checkout}.
The verdict you continue is {verdict}.

Read the brief in {brief}, the section "What the fix-check does", and follow
it exactly. Do not edit any file, push, comment on or merge anything. Your
last message is the JSON object the brief describes, and nothing else.
```

4. **Post the verdict.** Save the reviewer's or the fix-check's JSON to a file
   outside the tree, then, from the same checkout of the base as step 1:

   ```bash
   node scripts/review-verdict.mjs --write -R <owner/repo> <n> --verdict-file <file> --reviewed-head <head> --reviewed-digest <digest>
   ```

   It refuses a verdict whose head, change or declarations moved since step 1 (a
   declaration added during the review would otherwise be approved unread), or
   whose shape is wrong (an `approve` with a blocking finding, for one). A
   fix-check is refused too when it does not continue the newest verdict, or
   does not answer exactly the open blocking findings. It posts the comment and,
   on a repository with `ci.review.yaml`, reruns the check so that it reads the
   comment. Never write a verdict comment by hand, and never post a verdict the
   reader did not give.

   Post every verdict, as soon as it arrives and before you act on any finding:
   an `approve` whose minor findings you are about to fix, and every
   `changes-needed` and `unresolved`. The comments are the only record of what
   each reading found, and a verdict fixed without being posted is lost to
   everyone who later asks what the reviews catch. A verdict the script refuses
   because the change moved during the reading cannot be posted: run the same
   kind of reading again on the new head. One refused for its shape goes back to
   a new reader of the same kind.

5. **Act on it.** In a boundary round while the ruleset requires no review, act
   as the section above says. Otherwise:
   - On `approve` or `resolved`, the pull request is ready for its merge.
   - On `changes-needed` or `unresolved`, fix each open blocking finding (any
     minor one too, if you choose), verify, push, and run the fix-check (step
     3b). A finding you judge wrong is answered in a reply on the pull request,
     with the reason; the fix-check reads that reply and judges it.
   - After an `approve` or a `resolved`, you may still push: its minor findings,
     a red `Gate` fixed. Disarm an armed merge first
     (`gh pr merge <n> -R <owner/repo> --disable-auto`), push, run the
     fix-check, and arm the merge only on its `resolved`. Merging `main` with
     the change untouched keeps the verdict (the script's header says when).
   - On `needs-review`, run the one new full review (steps 2 to 4), which
     restarts the chain.

   No full review follows the first except after a `needs-review`. When two
   fix-checks in a row answer the same finding `unresolved`, stop: the finding
   or its fix is the maintainer's call. Hand it back with the finding and both
   answers, and run no third fix-check for it until they rule.

## What the reviewer does

You are reading a pull request you did not write. Your job is to find what is
wrong with it before it merges. You are the only full read this change gets:
after you, readers check only that your findings were fixed. Anything you do not
report now is caught by no later reviewer, and anything you report that is not
real costs the author a fix. Be complete, and be right.

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
  `istanbul ignore`; or a `// Stryker disable` comment, which takes a line out
  of the weekly mutation sweep) is judged like a skip, and its reason must be
  true. A hint over a line a test could reach is a blocking finding, and so is
  one whose reason describes something other than the line it hides.
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

**Hunt the class.** When a finding is one instance of a weakness (a scanner a
new shape slips past, an input shape a parser misses, one edge of a rule), look
for its siblings in the same pass: the other shapes, the other inputs, the other
edges. Report the class in one finding that names it and lists every instance
you found, so a fix that closes one example does not pass the fix-check.

**Verify before you answer.** Before writing the answer, take each candidate
finding in turn: re-open the code, confirm the line says what you think, and
name a concrete case that fails (these inputs, this wrong outcome or this
exposure). Check that `Gate` or `Test integrity` does not already refuse it.
Drop a finding that fails this, and make one that is a preference `minor`.

**Severity.** A finding is `blocking` when the pull request must not merge with
it: a defect, a security exposure, a behaviour change without a test that proves
it, an unjustified declaration, a broken law, a weakening of the gate, a private
id in a public repository. A claim in the body is blocking only when a reader
would act on it wrongly: a rollback that would not work, the security posture, a
test plan quoting a check that does not cover the changed path. Wording, stale
prose and preference are `minor`. A finding is `minor` when it is worth fixing
but the change is sound without the fix. The verdict is `approve` exactly when
no finding is blocking.

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

## What the fix-check does

You are checking that the findings of a review were fixed, not reviewing the
pull request again. The verdict you were given is the newest link of a chain:
one full review, then the fix-checks after it. Read narrowly.

**Read, in this order:**

1. The chain: from the verdict you were given back to the review, every
   `## Review` and `## Fix check` comment between them
   (`gh pr view <n> -R <repo> --json comments`), and the replies on the pull
   request since the review. A reply that answers a finding as wrong is judged,
   not obeyed.
2. The open blocking findings: the review's blocking findings, plus each
   fix-check's regressions, less those a fix-check answered `resolved`. Each is
   one line, as its verdict posted it.
3. What changed since the verdict you continue (its `Head:`): the change then
   against the change now, two runs of
   `git diff $(git merge-base origin/<base> <commit>) <commit>`, one at that
   head and one at `HEAD`, compared. A merge of `main` in between adds nothing
   to that comparison.
4. Each declaration in the body (`gh pr view <n> -R <repo> --json body`): one
   added after the review was read by no one else.

**Judge, and only this:**

- **Each open finding:** `resolved` when the code at `HEAD` no longer has it,
  for every instance it names when it names a class, or when a reply shows it
  was not real. Otherwise `unresolved`, with a one-line note saying what
  remains.
- **Regressions:** a defect in the lines the push changed, or an unjustified
  declaration. Report it as blocking, by the review's Severity rules. Nothing
  outside the push's lines, and no minor findings: those were the review's to
  find.
- **Security:** answer the questions in
  [../review-change-security/SKILL.md](../review-change-security/SKILL.md) that
  the push touches. A fix to a security finding is security code.
- **New behaviour:** when the push adds behaviour no finding asked for, the
  verdict is `needs-review`, and that work gets a full review.

The verdict is `resolved` exactly when every answer is resolved and there is no
regression; `unresolved` when an answer is unresolved or there is a regression;
`needs-review` as above.

**Answer** with one JSON object as your last message and nothing after it:

```json
{
  "check": "fix",
  "verdict": "resolved",
  "reviewer": "<the model you run on>",
  "security": "none found (untrusted input)",
  "continues": "sha256:<the Reviewed digest of the verdict you were given>",
  "answers": [
    {
      "finding": "backend/x.ts:42 (blocking) one line, exactly as posted",
      "resolved": true,
      "note": "what remains, when it is unresolved"
    }
  ],
  "regressions": [
    {
      "path": "backend/x.ts",
      "line": 50,
      "summary": "one line: what the fix broke and why it matters"
    }
  ]
}
```

`answers` names every open blocking finding exactly as posted, and is empty when
none is open (a push after an approve). `regressions` is empty when there are
none.
