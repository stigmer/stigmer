# Tasks: 20260225.01.cli-todo-blocks

**Created**: 2026-02-25

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Add TodoUpdateEvent to events.go

**Status**: ✅ DONE
**Created**: 2026-02-25 00:30
**Completed**: 2026-02-25 00:39

### Subtasks
- [x] Verify `m.blocks = blocks = append(...)` typo in handle_events.go (transcription artifact, not a real bug)
- [x] Add `TodoItem` struct to events.go (ID, Content, Status fields)
- [x] Add `TodoUpdateEvent` struct and `isEvent()` marker to events.go
- [x] Run `go build` to confirm new types compile cleanly

### Notes
- `TodoItem` is a domain type (not proto) with 3 string fields: ID, Content, Status
- `TodoUpdateEvent` carries full `[]TodoItem` snapshot (not per-item deltas)
- Timestamps intentionally omitted from domain type — backend concern, not TUI rendering
- Ordering left to renderer (Task 2) — event carries unordered slice
- Committed as `456b4fb9` on `fix/cli-agent-execution-ux`

## Task 2: Add todo block type and rendering (blocks.go, render_blocks.go)

**Status**: ✅ DONE
**Created**: 2026-02-25 00:30
**Completed**: 2026-02-25 00:55

### Subtasks
- [x] Add `blockTodo` const to `blocks.go`
- [x] Add `newTodoBlock()` constructor (expandable, starts expanded)
- [x] Add `todoGutter`, `todoStatusIcon`, `todoStatusWeight` to `render_blocks.go`
- [x] Add `sortTodosForDisplay` (stable sort by status group)
- [x] Add `renderTodoPreview` (collapsed summary: "Tasks (2/5 done)")
- [x] Add `renderTodoExpanded` (header + gutter-bordered items, dimmed completed/cancelled)
- [x] Add tests in `render_blocks_test.go`
- [x] Build and test pass

### Notes
- Block starts expanded (unlike tool blocks which start collapsed) — progress visibility is the feature's purpose
- Status icons: `●` in_progress, `○` pending, `✓` completed, `─` cancelled, `?` unknown
- Sort order: in_progress → pending → completed → cancelled (stable within groups)
- Completed/cancelled item content uses `dimStyle` — icon stays normal brightness for scannability
- Committed as `80f81724` on `fix/cli-agent-execution-ux`

## Task 3: Wire todo diffing in stream bridge (run_stream_events.go)

**Status**: ✅ DONE
**Created**: 2026-02-25 00:30
**Completed**: 2026-02-25 01:03

### Subtasks
- [x] Add `mapTodoStatus` enum-to-string conversion to `run_stream_convert.go`
- [x] Add `convertProtoTodos` proto map-to-domain slice conversion to `run_stream_convert.go`
- [x] Add `todoFingerprint` comparable struct for change detection
- [x] Add `emitTodoEvents` diff-and-emit function with debug trace logging
- [x] Add `buildTodoFingerprints` and `todoFingerprintsChanged` helpers
- [x] Wire as Step 1d in `streamToEvents` loop with guard condition
- [x] Add 9 tests covering all change detection edge cases
- [x] Build and test pass

### Notes
- Fingerprint-based change detection: `map[string]todoFingerprint{content, status}` — comparable struct gives free `!=` comparison
- Guard condition `len(todos) > 0 || len(prevTodos) > 0` skips diffing entirely for executions without todos
- `UNSPECIFIED` status maps to "pending" (safe fallback, shows open circle)
- Follows same diff-and-emit pattern as `emitToolCallStateEvents`
- 3 files changed, 355 lines added, all 9 new tests pass

## Task 4: Handle TodoUpdateEvent in handle_events.go

**Status**: ⏸️ TODO
**Created**: 2026-02-25 00:30

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 5: Wire todo handling in snapshot bridge (run_stream_snapshot.go)

**Status**: ⏸️ TODO
**Created**: 2026-02-25 00:30

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 6: Verify build compiles

**Status**: ⏸️ TODO
**Created**: 2026-02-25 00:30

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

