# Design Decision 004: Extend Renderer, Not Model

**Status**: Accepted
**Date**: 2026-03-05 (Session 5)
**Context**: Bubbletea v2 migration, Phase 4 (Ctrl+O during follow-up)

## Problem

The follow-up prompt lifecycle (activating after execution, waiting for user input, handling Ctrl+O during input) could be implemented in two ways:
1. Move history, expandMode, and re-commit logic into the Bubbletea model (`inlineBubbleModel`)
2. Keep it on the renderer (`inlineRenderer`) and extend the renderer's event loop lifecycle

## Decision

Extend the renderer's event loop lifecycle. `inlineRenderer` manages the follow-up phase via `activateFollowUp()` and `completeFollowUp()` methods. The Bubbletea model handles only the visual text input (receiving keystrokes, rendering the prompt in View()).

## Rationale

1. **Preserves the model/renderer boundary**: The Bubbletea model is a thin visual layer (spinner, approval menu, text input, streaming preview). The renderer owns the domain logic (event processing, history, re-commit, approval flow). This separation was established in project 01 and validated through three subsequent projects.

2. **SRP**: The model's responsibility is "render the current visual state and handle keystrokes." The renderer's responsibility is "process execution events and coordinate the terminal lifecycle." Follow-up logic (when to prompt, what to do with the input, how to continue the session) is clearly renderer territory.

3. **Testing**: Renderer logic is tested without a running Bubbletea program (unit tests with channel mocking). Model logic is tested via Bubbletea's test utilities. Mixing them would complicate both test suites.

4. **Incremental migration**: If a future project migrates more state into the model (e.g., for a full TUI mode), this decision doesn't block that. The renderer can be hollowed out incrementally.

## Trade-off

The renderer mutates config channels (nil-channel pattern, see decision 003) and holds lifecycle state (`followUpInputCh`, `donePhase`, `doneExitErr`) that is logically related to what the model renders. This creates a coupling where the renderer "tells" the model what to do via Send() messages, and the model "reports back" via channels. The indirection is acceptable given the clean boundary it maintains.

## References

- Predecessor decision: `_projects/2026-03/20260305.01.bubbletea-inline-renderer/design-decisions/001-conservative-bubbletea-integration.md`
- Checkpoint: `checkpoints/2026-03-05-session-5.md`
