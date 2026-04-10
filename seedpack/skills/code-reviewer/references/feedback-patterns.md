# Feedback Patterns

Templates and examples for structuring code review comments. Good review feedback
is categorized by severity, explains the reasoning, and suggests a path forward.

## Severity Prefixes

Use a consistent prefix on every comment so the author can triage efficiently.
Bold the prefix to make it scannable.

| Prefix | Meaning | Author Action |
|--------|---------|---------------|
| **Must fix** | Bug, security issue, data loss risk, or broken contract | Must address before merge |
| **Should fix** | Missing test, quality concern, or meaningful risk | Should address; discuss if you disagree |
| **Consider** | Genuine suggestion for improvement | Optional; author decides |
| **Note** | Observation, question, or positive callout | No action required |

## Comment Structure

Every review comment that requests a change should follow this structure:

1. **Severity prefix** — what category this falls into
2. **What you observed** — the specific code or pattern you're commenting on
3. **Why it matters** — the impact if left unchanged (bug, maintenance burden, risk)
4. **Suggested resolution** — a concrete path forward, phrased as a suggestion

Keep comments concise. If the explanation requires more than a short paragraph, the
issue may warrant a conversation rather than a review comment.

## Examples by Severity

### Must Fix

> **Must fix**: `formatAddress` is called on line 42 without checking whether
> `user.address` is nil. If the user hasn't set an address, this will throw a
> NullPointerException. The address field is optional per the User schema, so this
> path will be hit in production.
>
> Suggestion: add a nil guard before the call, or have `formatAddress` handle nil
> input and return an empty string.

**Why this works**: States the exact line, the specific failure mode, why it will
actually happen in production (the field is optional), and offers a concrete fix.

### Should Fix

> **Should fix**: The retry logic on lines 88-102 retries indefinitely on any
> error, including 400 Bad Request. A malformed request will never succeed on
> retry, but this loop will keep trying until the process is killed.
>
> Suggestion: retry only on transient errors (5xx, network timeouts) and set a
> max attempt count. Three retries with exponential backoff is a reasonable
> starting point.

**Why this works**: Explains the specific failure scenario (infinite retry on
non-transient errors), not just "the retry logic has issues."

### Consider

> **Consider**: The `calculateDiscount` function handles four different discount
> types through a chain of if/else branches (lines 34-78). This works correctly,
> but adding a fifth discount type would require modifying the function internals.
>
> Would it make sense to use a strategy map keyed by discount type? Each type
> would have its own calculation function, and adding a new type would be a
> one-line addition to the map rather than another branch.

**Why this works**: Acknowledges the code is correct, explains the maintenance
concern concretely (adding a fifth type), and phrases the suggestion as a question
that respects the author's judgment.

### Note

> **Note**: Nice approach to the connection pooling here. The bounded semaphore
> keeps the pool size predictable without requiring an explicit queue, and the
> context-based cancellation means callers won't hang indefinitely. Clean solution.

**Why this works**: Specific about what's good and why, not just "looks good."

## Common Feedback Scenarios

### Asking About Intent

When something looks wrong but might be intentional:

> **Note**: Line 56 catches `IOException` and returns an empty list instead of
> propagating the error. Is this intentional? I'd expect the caller to need to
> know that the file couldn't be read, but there might be a graceful-degradation
> reason I'm not seeing.

Don't assume it's a bug. The author may have context you lack.

### Pointing Out a Pattern Issue

When the same problem appears in multiple places:

> **Should fix**: The error from `db.Query` is discarded on lines 45, 72, and 103.
> In each case, the code proceeds with a nil result, which will cause a panic
> downstream. I'll leave a detailed comment on line 45 — the same fix applies to
> the other two locations.

One detailed comment, cross-referenced from the others. Don't write the same
explanation three times.

### Suggesting a Different Approach

When you'd solve the problem differently:

> **Consider**: This implementation walks the tree recursively to find matching
> nodes. An alternative would be to maintain an index keyed by node type during
> tree construction, which would make lookups O(1) instead of O(n).
>
> That said, if the tree is small (hundreds of nodes, not millions), the recursive
> approach is simpler and the performance difference won't matter. Up to you
> whether the optimization is worth the added complexity for your use case.

Present the tradeoff honestly. Don't push your preference as the obvious right answer.

### Flagging Missing Tests

> **Should fix**: The new `retryWithBackoff` function on line 30 doesn't have
> a corresponding test. This function has three interesting behaviors worth
> verifying: it retries on transient errors, it gives up on permanent errors,
> and it respects the max-attempts bound. Even one test covering the "gives up
> on permanent error" case would catch the most likely regression.

Explain specifically what the test should cover, not just "add tests."

## Anti-Patterns to Avoid

**The drive-by nit.** A comment that says "rename this" or "add a space here"
without any severity context. If it matters, explain why. If it doesn't, don't
leave the comment.

**The rewrite request.** A review comment that contains an entirely different
implementation of the same function. This is demoralizing and signals "I would
have done this differently" rather than "there's a problem here." If you truly
think a different approach is needed, have the conversation at the PR level, not
in a line comment.

**The ambiguous question.** "Is this right?" forces the author to guess what
you're concerned about. Be specific: "Is the < comparison intentional here? I'd
expect <= if we want to include the boundary value."

**The false must-fix.** Labeling a style preference as "must fix" erodes trust
in the severity system. Reserve "must fix" for things that will break in
production, compromise security, or violate a hard constraint.
