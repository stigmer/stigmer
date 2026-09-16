---
name: test-gate
description:
  Puts the session in the test engineer's posture: every code change in the
  conversation ships with tests, the default stance is adversarial, and work
  is not done until the ability to find problems is exhausted. Invoke by name
  when a change needs that gate, or when reviewing a change for missing
  coverage.
disable-model-invocation: true
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
   activities, agent behaviours, workflow task types, CLI commands or flags, UI
   components or interactions, bug fixes (what was broken, what was fixed),
   refactors (what behaviour must hold).
2. **Write the integration test first.** For each change ask how it is proven
   through the real system: an RPC through a running server, a workflow through
   the harness, an agent behaviour through execution status against the scripted
   model, a CLI command through its output, a browser journey through
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
   not run.
5. **Answer the questions before "done"** from the discipline reference. Any
   "no" and the work continues.

## Reporting

Lead with the issues found; the reader wants what is broken before what works.
Be blunt: "this crashes when the tool result is empty" is more useful than a
suggestion to consider handling it. Say which tests were written, what they
cover and how to run them. When a test is flaky, diagnose the cause (timing,
shared state, environment coupling); never retry or skip it into green. Never
report "looks good" without evidence: a clean result names what was tested,
which edges were explored, and why no issue is believed to remain.
