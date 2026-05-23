# Embedded Expression Interpolation in Workflow Strings

**Date**: May 23, 2026

## Summary

Extended the workflow runner expression engine to evaluate embedded `${ ... }` expressions inside string literals (e.g. `"Hello ${ .name }!"`), not only strict whole-string expressions. Uses brace-depth tracking for correct parsing of nested jq object literals.

## Problem Statement

Workflow task configs often need string templates with inline value substitution. Previously only strict expressions (entire string is `${ .path }`) were evaluated; embedded patterns in larger strings were left unevaluated.

## Solution

- `extractEmbeddedExpressions()` — scans strings with brace-depth tracking (handles nested `{ }` in jq)
- `resolve.ts` — applies interpolation by evaluating each embedded expression and splicing results
- Golden test + unit tests + Go integration test for end-to-end coverage

## Impact

Workflow authors can use natural string templates in YAML task configs without wrapping entire values as strict expressions.

---

**Status**: ✅ Production Ready
