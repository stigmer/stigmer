---
name: code-reviewer
description: >
  Review code changes with a structured methodology covering correctness, security,
  performance, and maintainability. Use this skill when asked to review a pull request,
  diff, code change, merge request, or patch. Also applies when asked to audit code
  quality, identify bugs in a changeset, or provide feedback on someone's code.
  Triggers on requests like: "review this PR", "look at this diff", "check this code
  for issues", "what do you think of this change", "audit this for security",
  or "give me feedback on my implementation".
---

# Code Reviewer

Review code changes systematically, delivering feedback that helps the author improve
the code without wasting their time on noise. This skill teaches a five-step review
methodology: understand, verify correctness, assess quality, evaluate risk, deliver
feedback. The goal is not to find every possible nit — it is to catch what matters
and communicate it clearly.

## Workflow

Follow these steps in order for every code review.

### Step 1: Understand the Change

Read the entire diff before commenting on any line. A change that looks wrong in
isolation often makes sense in context.

1. **Identify the intent.** What is this change trying to accomplish? Read the PR
   description, commit messages, and linked issues if available. If the intent is
   unclear from the diff alone, ask. Do not guess at intent and then review against
   your guess.

2. **Assess the scope.** Is this a focused change (bug fix, small feature, refactor)
   or a broad change (new subsystem, large refactor, migration)? Scope determines
   how deep your review should go:
   - **Focused changes**: Review every line. Correctness is the priority.
   - **Broad changes**: Focus on architecture, interfaces, and high-risk areas.
     Line-by-line review of a 2000-line change yields diminishing returns.

3. **Check for the test story.** Are there tests? Do they cover the changed behavior?
   The absence of tests is itself a finding — note it early so you can factor it
   into your confidence when reviewing the implementation.

### Step 2: Verify Correctness

This is the highest-value part of the review. Everything else is secondary to
catching bugs.

1. **Trace the logic paths.** Walk through the code mentally with concrete inputs.
   Focus on boundaries: what happens with empty input, nil/null values, the maximum
   size, concurrent access, and the first and last elements?

2. **Check error handling.** For every operation that can fail (network calls, file
   I/O, parsing, type conversions), verify that the error path is handled. Swallowed
   errors and catch-all handlers that log and continue are common sources of
   production incidents.

3. **Verify state transitions.** If the code modifies state (database writes, cache
   updates, in-memory mutations), trace what happens if the operation is interrupted
   midway. Is the state left consistent? Are there race conditions between concurrent
   callers?

4. **Check the contract between caller and callee.** When a function is called, are
   the arguments in the right order? Are preconditions met? Does the caller handle
   all possible return values, including error cases?

5. **Assess test coverage for changed code.** Tests that exercise the exact behavior
   being changed are more valuable than tests that happen to touch the same file.
   A change to a retry mechanism needs a test that verifies retry behavior, not just
   a test that calls the function.

### Step 3: Assess Quality

Quality issues don't break the code today but make it harder to change tomorrow.
Prioritize these below correctness but above stylistic preferences.

1. **Naming.** Do names accurately describe what they represent? A variable named
   `data` or `result` forces the reader to re-derive meaning from context every
   time. A function named `process` says nothing about what it does. Flag naming
   issues only when the name actively misleads or forces significant mental effort.
   Don't flag names that are merely "not what you would have chosen."

2. **Complexity.** Look for deep nesting (more than 3 levels), long functions (more
   than roughly 40 lines of logic), and god objects that accumulate responsibilities.
   Suggest specific decompositions rather than just saying "this is complex."

3. **Duplication.** Identical or near-identical logic appearing in multiple places
   within the change. Note it, but be careful about premature abstraction — two
   things that look similar today may diverge tomorrow. Duplication is only a problem
   when the duplicated logic must change in lockstep.

4. **Consistency with the codebase.** Does the change follow the patterns established
   in the surrounding code? Introducing a new pattern (different error handling
   style, different naming convention, different module structure) without migrating
   the existing code creates confusion. Either follow the existing pattern or propose
   a migration plan.

### Step 4: Evaluate Risk

Some correct, well-written code is still risky. Flag these concerns separately from
correctness and quality.

1. **Security.** Read [references/review-checklist.md](references/review-checklist.md)
   for the full security checklist. Key areas: input validation, authentication and
   authorization checks, secrets handling, SQL/command injection, cross-site scripting,
   and data exposure in logs or error messages.

2. **Performance.** Look for operations that scale poorly: nested loops over large
   collections, N+1 query patterns, unbounded memory allocation, blocking I/O in
   hot paths. Flag with specifics ("this loops over all users for every request —
   O(n*m)") rather than vague concern ("this might be slow").

3. **Breaking changes.** Does the change alter a public API, a database schema, a
   message format, or a configuration contract? Any change to an interface consumed
   by other systems or users needs explicit migration consideration.

4. **Deployment risk.** Does this change need a feature flag, a database migration,
   a coordinated rollout, or a rollback plan? Changes that can't be safely reverted
   deserve extra scrutiny.

### Step 5: Deliver Feedback

How you communicate findings determines whether they get addressed or ignored.

1. **Categorize every comment by severity:**
   - **Must fix**: Bugs, security vulnerabilities, data loss risks, or broken
     contracts. These block the change. Use sparingly and be certain.
   - **Should fix**: Quality issues, missing tests for changed behavior, risk
     concerns. These should be addressed but aren't blockers.
   - **Consider**: Suggestions for improvement that are genuinely optional. Style
     preferences, alternative approaches, minor naming improvements.
   - **Note**: Observations that don't require action. Context for the author,
     questions about intent, or callouts of particularly good work.

2. **Lead with the "why", not the "what."** "This will throw a NullPointerException
   when `user.address` is nil because `formatAddress` doesn't check for null input"
   is actionable. "Add a nil check here" is prescriptive without context.

3. **Suggest, don't demand.** For "should fix" and "consider" items, phrase feedback
   as suggestions with reasoning: "Would it make sense to extract this into a
   separate function? The retry logic and the business logic are interleaved, which
   would make it hard to test the retry behavior independently." The author may have
   context you don't.

4. **Batch related comments.** If the same pattern appears in five places, leave one
   detailed comment and reference it from the others. Don't write five independent
   comments that each explain the same thing.

5. **Acknowledge good work.** If a part of the change is well-designed, clearly
   written, or solves a tricky problem elegantly, say so. Reviews that contain
   only criticism discourage authors from seeking feedback.

Read [references/feedback-patterns.md](references/feedback-patterns.md) for templates
and examples of well-structured review comments.

## Key Principles

1. **Correctness is king.** A well-named, beautifully formatted function that produces wrong results is worse than an ugly function that works. Spend the majority of your review energy on logic, error handling, and edge cases.

2. **Review the change, not the codebase.** If surrounding code is messy, that's not the author's fault in this PR. Comment on pre-existing issues only if the current change makes them worse or if fixing them now is trivially easy.

3. **Every comment must earn its cost.** The author will spend time reading, understanding, and responding to every comment you leave. A comment that says "rename `x` to `val`" costs more in context-switching than it delivers in clarity. Reserve comments for things that materially affect correctness, security, maintainability, or understanding.

4. **Assume competence, verify intent.** If something looks wrong, consider that the author may have a reason you don't see. Ask before asserting: "Is this intentional? I'd expect this to handle the nil case" is better than "Bug: missing nil check."

5. **Be specific about risk.** "This might be slow" is useless. "This queries the database inside a loop — with N items, this will make N+1 queries instead of 1" gives the author something to act on.

6. **Don't rewrite the PR in comments.** If you would write the change completely differently, say so at the top level with your reasoning — then let the author decide. A review that rewrites every function is demoralizing and likely reflects a difference in approach, not a correctness problem.

## Reference Files

| File | When to Read |
|------|-------------|
| [references/review-checklist.md](references/review-checklist.md) | For the complete language-agnostic checklist organized by category: correctness, security, performance, maintainability, and testing |
| [references/feedback-patterns.md](references/feedback-patterns.md) | For examples of well-structured review comments at each severity level and templates for common feedback scenarios |
