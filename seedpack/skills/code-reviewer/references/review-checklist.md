# Review Checklist

A language-agnostic checklist for code review. Use this as a systematic scan after
you've read the change and understand its intent. Not every item applies to every
change — skip items that are irrelevant to the scope of the diff.

## Correctness

- [ ] Logic produces the expected result for normal inputs
- [ ] Edge cases are handled: empty collections, nil/null values, zero, negative
      numbers, maximum values, single-element collections
- [ ] Off-by-one errors: loop bounds, slice ranges, index calculations
- [ ] Type conversions are safe (no silent truncation, no loss of precision)
- [ ] String handling accounts for encoding, empty strings, and strings containing
      special characters (newlines, null bytes, unicode)
- [ ] Arithmetic operations guard against overflow, underflow, and division by zero
- [ ] Comparison operators are correct (< vs <=, == vs ===, equality semantics for
      the type being compared)
- [ ] Boolean logic is correct (De Morgan's law violations, missing/extra negations,
      short-circuit evaluation side effects)
- [ ] Resource cleanup: opened files, connections, locks, and temporary resources are
      released on all code paths including error paths
- [ ] Concurrency: shared state is protected, no data races between concurrent
      readers and writers, no deadlock potential from lock ordering

## Error Handling

- [ ] Every operation that can fail has its error case handled
- [ ] Error messages include enough context to diagnose the problem (what happened,
      what was expected, relevant identifiers)
- [ ] Errors are propagated appropriately — not silently swallowed, not caught and
      logged when the caller needs to know
- [ ] Partial failures leave state consistent (if step 2 of 3 fails, does step 1's
      result get rolled back or orphaned?)
- [ ] Retry logic has backoff and a maximum attempt count (no infinite retry loops)
- [ ] Timeouts are set for external calls (HTTP, database, RPC) — no unbounded waits

## Security

- [ ] User input is validated before use (length, format, range, allowed values)
- [ ] SQL queries use parameterized statements, not string concatenation
- [ ] Shell commands do not interpolate user input without escaping
- [ ] HTML output escapes user-provided content to prevent XSS
- [ ] Authentication checks are present on endpoints that require them
- [ ] Authorization checks verify the requesting user has permission for the
      specific resource, not just that they are authenticated
- [ ] Secrets (API keys, tokens, passwords) are not logged, not included in error
      messages, and not committed to source control
- [ ] Cryptographic operations use standard library functions, not hand-rolled
      implementations
- [ ] File operations validate paths to prevent directory traversal
- [ ] Deserialization of untrusted data uses safe methods (no pickle/eval on
      user input)

## Performance

- [ ] No N+1 query patterns (querying inside a loop when a single batch query
      would work)
- [ ] No unbounded collection growth (lists, maps, or caches that grow without
      limits over the lifetime of the process)
- [ ] Expensive operations (network calls, disk I/O, heavy computation) are not
      in hot loops
- [ ] Large datasets are processed with streaming or pagination, not loaded
      entirely into memory
- [ ] Database queries use appropriate indexes (or the change adds indexes for
      new query patterns)
- [ ] Caching, if used, has invalidation logic and bounded size

## Maintainability

- [ ] Functions have a single clear responsibility — not "do X and also Y if Z"
- [ ] Public interfaces are minimal — only expose what consumers need
- [ ] Magic numbers and strings are named constants with explanatory names
- [ ] Complex conditional logic has a comment explaining the business rule it
      implements, or is extracted into a well-named function
- [ ] The change follows the existing patterns in the codebase (or explicitly
      migrates away from them)
- [ ] No dead code introduced (unused imports, unreachable branches, commented-out
      code "for later")

## Testing

- [ ] Tests exist for the changed behavior (not just the changed file)
- [ ] Tests cover the happy path and at least one error/edge case
- [ ] Tests verify behavior, not implementation details (testing what the code does,
      not how it does it internally)
- [ ] Test names describe the scenario and expected outcome
- [ ] Tests are deterministic — no dependence on timing, external services, or
      random values without seeds
- [ ] Mocks and stubs are used judiciously — over-mocking makes tests pass even
      when integration is broken
