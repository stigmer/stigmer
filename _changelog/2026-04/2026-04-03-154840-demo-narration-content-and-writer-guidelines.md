# Demo Narration Content and Document Writer Guidelines

**Date**: April 3, 2026

## Summary

Added spoken narration scripts to all 10 playback demo scenarios and established narration authoring guidelines in the document writer role. Each demo now has a `narration` field on concept-critical steps that a build-time TTS engine will convert to audio. The narration layer is opt-in and invisible to viewers who keep demos muted.

## Problem Statement

The demo engine (Phase 1) and TTS build script (Phase 2) were ready to produce narrated audio, but no narration text existed in any scenario. The document writer role also had no guidance on how to write narration, which would lead to inconsistent quality as future scenarios are authored.

### Pain Points

- Zero scenarios had narration content — the TTS pipeline had nothing to generate
- No authoring guidelines existed, risking formulaic or overly verbose narration in future work
- The three creation tours share identical 12-step UI structure, making repetitive narration a quality risk

## Solution

Authored narration text for all 10 playback scenarios (75 steps total, 30 narrated) following a content-first approach: update the writer guidelines first, then write narration in batches with human review after each group.

## Implementation Details

### Document writer role update

Added a "Narration for playback demos" subsection to `_roles/002_document_writer.md` under "Live demos with SDK components." The section covers:

- What the `narration` field is and how it relates to `caption`
- Writing rules: register-matched, concept-focused, 1–2 sentences max
- The rhythm principle: not every step needs narration — visual transitions can be silent
- A self-check for reading narration aloud

Kept to ~15 lines — parallel in density to the cursor overlay subsection. Excludes build pipeline details, timing mechanics, and voice selection.

### Narration content across 10 scenarios

| Scenario | Steps | Narrated | Emphasis |
|----------|-------|----------|----------|
| quickstart-playback | 6 | 3 | Generic answers → need for domain knowledge |
| api-key-setup | 8 | 3 | Purpose, context, payoff |
| skill-creation-tour | 12 | 5 | Domain knowledge, teaching the agent |
| agent-creation-tour | 12 | 4 | Blueprint composition, skills + tools + rules |
| mcp-server-creation-tour | 12 | 4 | External connections, authentication |
| discover-capabilities | 6 | 3 | Tool discovery flow |
| generate-policies | 6 | 3 | Read vs write tools, safety rules |
| approval-flow | 5 | 3 | Agent pauses, human approves, execution waits |
| tool-calls | 4 | 2 | Real data lookup vs guessing |
| session-memory | 6 | 3 | Context retention across messages |

### Key narration principles

- **Narrate concepts and outcomes, not screen mechanics.** "The agent pauses and asks a human to approve" — not "Now a card appears on screen."
- **Silent steps are deliberate.** Navigation, scrolling, and cursor clicks are visual pauses where silence lets the viewer process.
- **Register matches the page.** Quickstart narration uses the simplest language. Concept demos can be more precise.
- **Each creation tour sounds distinct** despite identical UI structure — Skill=knowledge, Agent=composition, MCP server=connections.

## Benefits

- All 10 scenarios are ready for `make generate-narration` to produce MP3 audio files
- Future narration authoring is guided by the document writer role — consistency across sessions and authors
- Narrated demos will produce both interactive website experiences (muted by default) and video-ready audio for the export pipeline

## Impact

- **11 files modified**: 1 role file + 10 scenario step definitions
- **+104 lines** across all files (net)
- **Zero regressions**: TypeScript zero errors, ESLint zero warnings, all existing demos render identically

## Related Work

- [ScenarioPlayer Audio Narration Engine](2026-04-03-151559-scenario-player-audio-narration-engine.md) — Phase 1: the engine that plays narration audio
- [TTS Narration Build Script](2026-04-03-152701-tts-narration-build-script.md) — Phase 2: the build script that converts narration text to audio

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour (content authoring with batch review)
