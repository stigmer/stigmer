# Tasks: 20260402.01.skill-creation-demo-component

**Created**: 2026-04-02

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Design the component architecture — define step sequence, data model, and which sub-components are needed (AppShell, Sidebar, SkillsListView, SessionComposerView)

**Status**: ✅ DONE
**Created**: 2026-04-02 13:27
**Completed**: 2026-04-02

### Subtasks
- [x] Define GuidedTourStep discriminated union data model
- [x] Design 8-step sequence with timings
- [x] Define component hierarchy (DemoAppShell, SkillsListView, ComposerView)
- [x] Decide fidelity level (representative/schematic)
- [x] Decide animation approach (pulse/highlight, no cursor)
- [x] Plan duplicate message bug fix (snapshot pattern)
- [x] Document architecture in notes.md

### Notes
- Architecture documented in notes.md under "Architecture" section
- Full plan in `.cursor/plans/skill_creation_guided_tour_dfdca60b.plan.md`

## Task 2: Build the DemoAppShell wrapper component — simplified web app layout with sidebar and content area

**Status**: ✅ DONE
**Created**: 2026-04-02 13:27
**Completed**: 2026-04-02

### Subtasks
- [x] Create DemoAppShell.tsx with flexbox sidebar + content layout
- [x] Implement nav items (Dashboard, Library, Settings) with lucide-react icons
- [x] Add activeNav prop for selected state
- [x] Add highlightNav prop with framer-motion pulse animation
- [x] Add contentKey prop for fade transitions between views

### Notes
- Sidebar is 144px (w-36), representative not pixel-accurate
- Content area uses motion.div keyed on contentKey for smooth transitions

## Task 3: Build individual view components — SkillsListView and ComposerView renders for each step

**Status**: ✅ DONE
**Created**: 2026-04-02 13:27
**Completed**: 2026-04-02

### Subtasks
- [x] Build SkillsListView with mock skill cards and "Create Skill" button
- [x] Add highlightCreate prop with pulse animation on the button
- [x] Build ComposerView with agent header bar
- [x] Integrate real MessageThread from @stigmer/react for conversation rendering
- [x] Implement empty/ready state for composer-ready step

### Notes
- SkillsListView shows 2 mock skills (Product Catalog, Escalation Runbook)
- ComposerView uses real MessageThread component per embedded component standard
- Empty state shows placeholder input with descriptive text

## Task 4: Integrate with ScenarioPlayer — wire all views as ScenarioPlayer steps with appropriate timing

**Status**: ✅ DONE
**Created**: 2026-04-02 13:27
**Completed**: 2026-04-02

### Subtasks
- [x] Build DemoSkillCreationTour.tsx as top-level component
- [x] Wire ScenarioPlayer<GuidedTourStep> with render prop dispatch
- [x] Implement contentKeyFor() to group view transitions
- [x] Set up StigmerProvider with demo client

### Notes
- contentKeyFor() returns "dashboard", "skills", or "composer" — only triggers
  fade transition when the content category changes, not on every message snapshot
- renderStep() dispatches on step.view to render correct sub-component in DemoAppShell

## Task 5: Update first-skill.mdx — replace DemoSkillCreation with the new guided-tour component

**Status**: ✅ DONE
**Created**: 2026-04-02 13:27
**Completed**: 2026-04-02

### Subtasks
- [x] Add DemoSkillCreationTour to barrel export (index.ts)
- [x] Update mdx.tsx global component registration
- [x] Replace import and usage in first-skill.mdx
- [x] Verify TypeScript type check passes (tsc --noEmit: clean)

### Notes
- Old DemoSkillCreation.tsx kept but no longer exported from barrel
- skill-creation.ts (fixture data) also kept — still useful as reference


## Project Completion Checklist

When all tasks are done:
- [x] All tasks marked ✅ DONE
- [x] Final testing completed (tsc --noEmit passes, zero linter errors)
- [x] Documentation updated (notes.md with architecture decisions)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

