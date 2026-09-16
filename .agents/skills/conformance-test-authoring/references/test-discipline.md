# Test discipline

The posture every test in this repository is written and reviewed with. The
`test-gate` skill invokes it as a mode; the conformance skill applies it to the
suite. Neither restates the other.

## The job is to find problems

A test's value is the issue it exposes, not the green it reports. A run that
passes on the first attempt and never fails again has proven little. The default
posture toward any change is scepticism:

- Assume the code is broken until proven otherwise; the happy path is the start,
  not the end.
- Think like a hostile caller: which inputs cause a crash, corrupt data, or
  cross a permission boundary?
- Hunt for what is missing. The dangerous bugs live in scenarios nobody wrote
  down: a timeout, a partial failure, concurrent access, empty input, absurdly
  large input.
- Question every assumption. If the code assumes a field is present, test
  without it; if it assumes order, test out of order; if it assumes idempotency,
  call it twice.
- Probe the boundaries: off-by-one, empty and single-element collections,
  maximum payloads, unicode, timezone edges.

"Done" is when the ability to find issues is exhausted: happy, sad, edge and
adversarial paths tested; adjacent behaviour checked for regression; error
messages verified useful, not merely thrown; every finding written down. A clean
report states what was tested so others can judge the coverage.

## Red flags a reviewer catches

- An error swallowed silently: an empty catch, an ignored return.
- Input from a user or an external system accepted without validation.
- State mutated without a concurrency guard.
- A value hard-coded that should be configurable, or configurable that should be
  a named constant with a reason.
- A test that asserts on implementation detail instead of behaviour.
- A test that cannot fail: a tautology, a matcher too broad to miss anything.
- Cleanup or resource release missing on the non-happy path.
- Behaviour that differs between the first run and the second.

## The two tests to consider every time

An integration test proves the system works end to end through its real
boundaries; it catches what units miss and is what gives confidence to ship. A
unit test is fast and exhaustive over branching logic, transformation,
validation and computation. Most changes need both: the unit proves the logic,
the integration proves it works in the system. A bug fix starts with the test
that reproduces the bug.

Where each lives in this repository: a cross-edition contract or a runner
behaviour read through execution status in `test/conformance/`; a server or
runner unit beside its module in a `__tests__` folder; a React unit under
`sdk/react/src/`; a browser journey under `test/e2e/tests/`; a repository
script's test beside it in `scripts/`.

## Shape

- The name states the scenario and the expected outcome; a reader learns the
  contract from the test list alone.
- Arrange, act, assert, visibly separated.
- Deterministic: poll with a timeout instead of sleeping; unique resource names;
  no order dependence; no dependence on a pre-existing database or service; temp
  directories, never the home directory or the working tree.
- LLM-dependent tests assert on structure and side effects, never on prose.
- A failing assertion explains itself: what was expected, what was observed, and
  the identifiers needed to look further.

## The questions before "done"

- Does every new behaviour have a test that proves it end to end?
- Does every function with logic have a unit test over its branches?
- Do the tests run, and pass, here and in CI?
- Would the tests catch a revert of the change?
- For a bug fix, does a test reproduce the original bug?

Any "no" means the work is not done.
