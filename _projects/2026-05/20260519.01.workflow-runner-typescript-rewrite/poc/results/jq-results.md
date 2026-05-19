# T01a: jq Expression Validation Results

**Date**: 2026-05-19T07:02:19.268Z

## jq-wasm (jq-wasm@1.1.0-jq-1.8.1)

| Metric | Value |
|--------|-------|
| Runtime expressions | 20/22 passed |
| Transform expressions | 5/5 passed |
| Overall pass rate | 92.6% |
| Avg latency | 0.66ms |
| Custom variables | YES (via wrapping) |
| Custom functions | NO |

### Failed Tests

- **always-true**: `1 == 1`
  - Expected: `true`
  - Actual: `undefined`
  - Error: Invalid argument: 'json' must be a string or non-null object

- **builtin-now**: `now`
  - Expected: `"__TIMESTAMP__"`
  - Actual: `undefined`
  - Error: Invalid argument: 'json' must be a string or non-null object

### Notes

- In-process WASM, no subprocess overhead
- Variables injected via expression wrapping (not native --argjson)
- Custom functions (uuid) NOT supported — must be pre-processed
- No external binary dependency

---

## node-jq (node-jq@6.x (subprocess))

| Metric | Value |
|--------|-------|
| Runtime expressions | 22/22 passed |
| Transform expressions | 5/5 passed |
| Overall pass rate | 100.0% |
| Avg latency | 2.85ms |
| Custom variables | YES (via wrapping) |
| Custom functions | NO |

### Notes

- Subprocess to system jq binary — requires 'jq' installed
- Variables injected via expression wrapping
- Custom functions (uuid) NOT supported — must be pre-processed
- Full jq spec compliance (uses real jq binary)
- Higher latency due to process spawn per call

---

## Gate Assessment

**PASS**: node-jq achieves 100.0% pass rate. jq expression evaluation is viable in TypeScript.
