# Skill Resource Documentation

**Date**: February 25, 2026

## Summary

Created a comprehensive seven-document documentation set for the Skill resource at `apis/ai/stigmer/agentic/skill/docs/`. This closes the producer-side knowledge gap: the existing agent docs covered skills only from the consumer (agent author) perspective. The new docs cover skills from the skill author's perspective — how to build, package, publish, version, and validate skill artifacts. All content is grounded in the actual proto files, CLI source code, and backend implementation rather than assumptions.

## Problem Statement

The agent docs at `apis/ai/stigmer/agentic/agent/docs/` referenced skills (`skill-integration.md`) but treated them as a black box — existing documentation told you how to *reference* a skill from an agent, but nothing told you how to *create* one.

### Pain Points

- No documentation explaining the fundamental Agent vs. Skill asymmetry: Agents are applied as YAML; skills are pushed as artifact directories. This is the single most common source of confusion for users coming to skills after learning agents.
- The `SKILL.md` file format (frontmatter fields, body guidelines, the distinction between machine-readable metadata and agent-directed instructions) was entirely undocumented.
- The push workflow — local push, remote git push, and the SDK `SkillSynth` handover mechanism — lived only in proto comments and Go docstrings.
- The versioning model (SHA-256 content hashes as immutable identifiers, mutable tag pointers, deduplication, archived versions) was scattered across four proto files and never explained as a unified model.
- The `--tag latest` default behavior (every push tags `latest` unless overridden) was particularly dangerous — undiscovered, it leads to unpredictable agent behavior in team and CI/CD environments.

## Solution

Seven focused documents in `apis/ai/stigmer/agentic/skill/docs/`, each with a single clear responsibility:

1. **`README.md`** — Entry point. Establishes the Agent vs. Skill contrast table, lifecycle diagram, and two-audience framing (skill authors vs. agent authors referencing skills).
2. **`skill-resource-guide.md`** — API schema reference. Documents every `metadata`, `spec`, `status`, `GitProvenance`, and `SkillState` field. Includes the complete CLI command reference with all flags.
3. **`skill-md-format.md`** — The most unique document in the set. Covers the `SKILL.md` frontmatter schema (all three fields: `name`, `description`, `version`), body authoring guidelines, package directory structure (`references/`, `scripts/`, `assets/`), `.stigmerignore`, and CLI filtering flags.
4. **`publishing-skills.md`** — Push workflow in three paths: CLI local push, CLI remote git push, and Go SDK `FromDir`/`FromGit` handover. Includes the complete backend processing sequence and first-push vs. update semantics.
5. **`versioning.md`** — The full versioning model. Two-layer design (immutable hash + mutable tag), deduplication behavior, `latest` default semantics, version resolution table, archived versions, and pinning strategy with a clear when-to-use-each recommendation.
6. **`examples.md`** — Complete, working examples: minimal skill, tagged release, multi-file skill with `references/`, remote git push, Go SDK usage, and iterative development workflow.
7. **`validation-checklist.md`** — Pre-push checklist and ten common pitfalls with wrong/correct contrasts. Covers frontmatter parsing errors, `name` format violations, stale tag trust, duplicate push expectations, and artifact content surprises.

## Implementation Details

### Source Verification

All documentation was derived from primary sources, not proto comments alone:

- **`SKILL.md` frontmatter fields**: Verified against `backend/services/stigmer-server/pkg/domain/skill/storage/frontmatter.go`. Discovered a third field (`version`, informational) that was not reflected in the proto types and would have been missed without reading the implementation.
- **CLI command signatures**: Verified against `client-apps/cli/cmd/stigmer/root/push.go`, `get.go`, `list.go`, `delete.go`. Confirmed the unified command pattern (`stigmer push skill`, not `stigmer skill push`) and all flag defaults including the critical `--tag latest` default.
- **SDK API surface**: Verified against `sdk/go/skill/synth.go`. Documented the actual public API: `skill.FromDir()`, `skill.FromGit()`, `skill.WithTag()`, `skill.WithRef()`, `skill.WithSubdir()`, `skill.WithGitTag()`.
- **Backend processing**: Verified against `client-apps/cli/cmd/stigmer/root/push.go` and `client-apps/cli/internal/cli/skill/push_remote.go` for the git clone/checkout strategy (shallow vs. full clone based on ref type).

### Key Discovery: `--tag latest` is the Default

The `push.go` source shows `cmd.Flags().StringVar(&tag, "tag", "latest", ...)` — the default tag is `latest`, not empty. This means every push without an explicit `--tag` silently moves the `latest` pointer. This behavior is now prominently documented in `publishing-skills.md`, `versioning.md`, and `validation-checklist.md`.

### Cross-Reference Architecture

The skill docs are designed to complement, not duplicate, the existing agent docs:

- `skill-resource-guide.md` → links to `agent/docs/resource-references.md` for `ApiResourceReference` format
- `versioning.md` → links to `agent/docs/resource-references.md` (version field semantics) and `agent/docs/skill-integration.md` (runtime resolution)
- `README.md` → links to `agent/docs/skill-integration.md` for agent authors following from the skill side

## Benefits

- **Zero ambiguity on authoring**: Every field in `SKILL.md` frontmatter is documented with format constraints, examples, and error messages that mirror what the backend actually returns.
- **Push workflow is fully traceable**: Users can follow the end-to-end flow from `stigmer push skill` through the backend processing steps to the resulting `SkillStatus` fields.
- **Versioning is demystified**: The two-layer model (hash + tag) and the `latest` default behavior are now explained with concrete decision guidance, preventing the most common production reliability mistake.
- **Parity with agent docs**: Skills now have the same documentation depth as agents. Both resources are first-class citizens in the platform documentation.

## Impact

- **Skill authors** (primary audience): Can build, package, and publish skills correctly without reading source code or proto comments.
- **Agent authors** (secondary audience): Understand what a skill version hash means and how to pin reliably for production.
- **Platform maintainers**: The `SKILL.md` format and versioning model are now documented as platform contracts, not implementation details.

## Related Work

- [Agent Documentation Restructure](2026-02-25-224912-agent-docs-restructure.md) — The agent docs that established the pattern this documentation mirrors.
- [Skill Pre-Push Validation](2026-02-04-183535-skill-pre-push-validation.md) — The backend validation that the `validation-checklist.md` pitfalls section is built on.
- [CLI Skill Handlers Implementation](2026-02-07-161327-cli-skill-handlers-implementation.md) — The CLI implementation these docs describe.

---

**Status**: ✅ Production Ready  
**Timeline**: Single session — research (reading 15+ source files) + authoring (7 documents, ~1,700 lines total)
