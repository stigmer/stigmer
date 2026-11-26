---
name: test-gate
description:
  Puts the session in the test engineer's posture, where every code change ships
  with tests and work is not done until the ability to find problems is
  exhausted. Use when writing or changing code, adding or changing tests, fixing
  a bug, verifying a change before calling it done, or reviewing a change for
  missing coverage.
---

# The test gate

When this skill is invoked, no work in the conversation is done until tests
exist for it. Not optional, not a follow-up: the gate. If you are about to say
the implementation is done and have not written the tests, stop; you are not
done.

The discipline this gate enforces is in
[../conformance-test-authoring/references/test-discipline.md](../conformance-test-authoring/references/test-discipline.md):
the adversarial posture, the red flags, the two tests to consider, the shape,
and the questions before "done". Read it once per session under this gate.

## For every piece of work in the conversation

1. **List what changed.** New or modified RPCs, Temporal workflows or
   activities, agent behaviours, CLI commands or flags, UI components or
   interactions, bug fixes (what was broken, what was fixed), refactors (what
   behaviour must hold).
2. **Write the integration test first.** For each change ask how it is proven
   through the real system: an RPC through a running server, a Temporal workflow
   through the harness, an agent behaviour through run status against the
   scripted model, a CLI command through its output, a browser journey through
   Playwright. The conformance suite is the home for cross-edition contracts and
   runner behaviour; `.agents/skills/conformance-test-authoring/SKILL.md` says
   how a test there is shaped. A bug fix's test reproduces the bug before the
   fix.
3. **Write the unit tests.** Every function with branching, transformation,
   validation or computation: table-driven over its edge cases; every state
   machine over each transition and each invalid transition; every error path
   producing its exact error.
4. **Run them.** The root guide's verification map names the command for each
   path prefix; quote each summary line. Work is not complete on a test that has
   not run. For a change to a package's source, measure it too: `Gate` refuses a
   line the change adds that no test runs, and "What holds them" in
   `test/README.md` has the command that names those lines before you push. In
   stigmer-cloud, `make gate`'s coverage step applies the same rule.
5. **Answer the questions before "done"** from the discipline reference. Any
   "no" and the work continues.

## First-hour journeys

A developer's first hour (sign-up, an agent, the chat in their app, a sign-in to
their tool server, the agent calling the tool) is proven by
`test/e2e/tests/first-hour`, in the Gate on every change it can break
(`ci.first-hour.yaml`) and nightly against Stigmer Cloud with the same specs
(`test/e2e/helpers/first-hour/target.ts`). A change to any part of that hour
adds to or changes that journey, and keeps its rules, each held by what is
named:

- **A real browser.** Playwright's Chromium drives every screen, the login pages
  included; no step is a call standing in for a click a person makes
  (`test/e2e/playwright.config.ts`, project `first-hour`).
- **The host on its own origin.** The embedded chat runs in the embedding
  tutorial's app on its own address, never on the console's
  (`test/e2e/tests/first-hour/3-embedded-tool-call.spec.ts`,
  `test/e2e/helpers/embed-tutorial.ts`).
- **A real login server.** Tool servers sign in through an OAuth login server
  with a consent page that carries an opener policy, as Sentry's does
  (`test/conformance/src/harness/oauth-mcp-fixture-main.ts`); the CLI signs in
  through the same browser (`test/e2e/helpers/cli.ts`, `BROWSER`).
- **The docs run as written.** The steps come from the pages, tab by tab: the
  quickstart's Stigmer Cloud tab and the embedding tutorial
  (`test/install/lib/doc-steps.mjs`, `target`), so a renamed line turns the
  journey red before it merges.
- **The proof is the tool's answer.** Each tool step sends a fresh nonce and
  asserts it in the tool's result (the console's and the app's tool row, the
  CLI's NDJSON), never a screen appearing or the model saying it called
  something (`test/e2e/helpers/first-hour/steps.ts`). A step the product cannot
  yet finish is held as a known gap on its issue
  (`test/support/src/known-gap.ts`), which fails the day the issue is fixed.
- **A quarantine has an owner and an end date.**
  `// quarantined: <repo>#<issue> owner=<login> until=<YYYY-MM-DD>`, at most 14
  days out (`scripts/test-integrity.mjs`, rule `quarantine-terms`;
  `test/README.md`, rule 3).

## Reporting

Lead with the issues found; the reader wants what is broken before what works.
Be blunt: "this crashes when the tool result is empty" is more useful than a
suggestion to consider handling it. Say which tests were written, what they
cover and how to run them. When a test is flaky, diagnose the cause (timing,
shared state, environment coupling); never retry or skip it into green. Never
report "looks good" without evidence: a clean result names what was tested,
which edges were explored, and why no issue is believed to remain.
