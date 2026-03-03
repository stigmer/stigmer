# Notes: 20260303.01.fix-oss-org-scoping

**Created**: 2026-03-03

## Purpose

Use this file to capture important information as you work:

- 🎯 **Decisions**: Why you chose approach A over B
- 🐛 **Gotchas**: Issues discovered and how you solved them
- 💡 **Learnings**: Insights that might help later
- 📝 **Commands**: Useful commands or snippets
- 🔗 **References**: Links to docs, Stack Overflow, etc.

Keep entries **timestamped** and **concise**. This isn't a novel - just enough context to remember later.

---

## 2026-03-03 06:53 — Full Audit Complete

### Symptom
`stigmer draft skill` fails with "skill-creator agent not found in organization default".
`stigmer list agents --org local` shows all 3 system agents created 2 days ago under `local`.
`stigmer list agents` (default org) shows nothing.

### Root Cause Chain
1. Original bootstrap created agents under org `local` (pre-migration default)
2. Org-tenancy migration changed CLI default to org `default`
3. Seedpack `stigmer.yaml` updated to `metadata.org: default`
4. Bootstrap re-runs with `org: default`, but server's `LoadForApply.findBySlug`
   matches existing `local/skill-creator` by slug (no org filter)
5. `BuildUpdateState` preserves `org: local` as immutable
6. Agent stays under `local` forever

### Architectural Insight
The `LoadByReference` step already has correct org filtering — all other steps
were written before org was introduced and never updated. This is a systematic
gap, not an isolated bug.

### Key Constraint
`build_update_state.go` line 129: `mergedMeta.Org = existingMeta.Org` — Org is
immutable on updates. This is correct behavior, but it means the findBySlug
MUST be org-scoped, otherwise you can never create a new resource with the same
slug in a different org.

### Deferred (Phase 3, not in this project)
- Query/List controllers missing org in request protos (8 methods across
  AgentExecution, Session, WorkflowExecution, WorkflowInstance, AgentInstance)
- `Store.ListResources` has no org param — performance optimization for later
- These are fine for single-org OSS but would need fixing for multi-org support

---

## 2026-03-03 07:02 — Task 1 Complete: FindResourceBySlug org-scoped

### Decision: Keep `(T, error)` return type
The reference implementation in `LoadByReferenceStep.findBySlug` uses `(T, bool, error)`,
but `FindResourceBySlug` uses `(T, error)` with nil-check at the call site. Changing
the return type would be a separate refactoring concern unrelated to org scoping.
The nil-check pattern works correctly for proto messages.

### Decision: Empty org = no filtering
Consistent with the reference implementation: `if org != "" && metadata.Org != org { continue }`.
This preserves backward compatibility — callers that don't have org context yet can pass `""` and
get the old global behavior until they're updated.

### Observation: No existing tests for FindResourceBySlug
There is no `helpers_test.go` file at all. The function had zero test coverage before this change.
New tests are planned for Task 6 which covers all org-scoping tests.

---

## 2026-03-03 — Task 2 Complete: LoadForApplyStep org-scoped + FindResourceBySlug (T, bool, error)

### Gotcha: Go generics `T == nil` does not compile
The plan assumed `existing == nil` would work on a type parameter `T` constrained to
`proto.Message`. It does not. Go does not allow comparing type parameter values to `nil`
with `==`, even when all concrete instantiations are pointer types. The compiler error:
`invalid operation: existing == nil (mismatched types T and untyped nil)`.

This forced upgrading `FindResourceBySlug` from `(T, error)` to `(T, bool, error)`.

### Decision: Upgrade to `(T, bool, error)` return type (supersedes Task 1 decision)
Task 1 deferred the return type change as "a separate refactoring concern." Task 2 proved
it is not separable — the `(T, error)` pattern cannot be consumed from generic callers
(other pipeline steps). The `(T, bool, error)` signature now matches `LoadByReferenceStep.findBySlug`
(the reference implementation) and correctly models three outcomes: found / not-found / error.

### Decision: Consolidate into shared helper
Rather than patching `LoadForApplyStep`'s private `findBySlug` with an org param (preserving
duplicated code), deleted the private method entirely and delegated to `FindResourceBySlug[T]`.
Net reduction: ~25 lines. Same consolidation pattern should apply to Tasks 3 and 4.

### Build verification
All 9 workspace modules (`apis/stubs/go`, `backend/libs/go`, `backend/services/stigmer-server`,
`backend/services/workflow-runner`, `client-apps/cli`, `mcp-server`, `sdk/go`, `seedpack`, `tools`)
build cleanly.

---

