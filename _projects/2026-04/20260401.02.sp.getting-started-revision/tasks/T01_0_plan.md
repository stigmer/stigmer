# Task T01: Getting Started Documentation Revision

**Created**: 2026-04-01 18:00
**Status**: PENDING REVIEW
**Type**: Sub-Project of 20260331.01.content-strategy (spawned from T01 Phase 3)

**This plan requires your review before execution.**

---

## Problem Statement

Phase 3 delivered three Getting Started pages (Cloud quickstart, Local quickstart, Your First Skill). They have structural problems that prevent the reader from experiencing a connected, progressive journey:

1. **Cloud quickstart does too much.** It mixes sign-up/SDK integration with skill creation via the web console. The reader never gets a clean "I connected Stigmer" moment.
2. **Implementation drifted from the IA.** The information architecture's 5-minute path says Cloud quickstart should produce "a running agent that answers generic questions." The page instead creates a skill, contradicting the IA.
3. **No narrative continuity.** Pages don't reference each other. No "you just did X, here's what Y unlocks."
4. **First Skill only follows Local.** Cloud users have no forward path after the quickstart.
5. **Embedded demo is static.** `DemoSkillCreation` renders a completed `MessageThread`. No sense of journey — messages appearing, responses streaming, artifacts generating.
6. **Docs homepage is generic.** A 4-card routing hub with no story, no journey preview.
7. **Use Cases/GitHub in docs sidebar.** Marketing links leak into the documentation navigation.

## Key Design Insight

The seedpack `assistant` agent (`seedpack/agents/assistant.yaml`) is labeled `stigmer.ai/default-agent: "true"`. When a user creates a session without specifying an agent, Stigmer uses this assistant automatically.

**Implication**: The Cloud Quickstart does NOT require the reader to create or understand agents. The flow is: sign up → API key → SDK → create session → send message → get response. The concept of a named, custom agent comes later — when there's a reason to package specific skills + tools + instructions together.

## Revised Journey

```
Entry Points (choose one):
  Cloud Quickstart (5 min) ──┐
  Local Quickstart (5 min) ──┤
                              ▼
  Your First Skill (10 min) ──→ Give Your Agent Tools (15 min) ──→ ...
```

- **Cloud Quickstart**: Sign up, API key, SDK, create session, send message, get response. Implicit assistant agent. Aha: "I have an AI agent I can call from my code in 5 minutes."
- **Local Quickstart**: Alternative entry for CLI-first developers. Same destination, different path.
- **Your First Skill**: Create domain knowledge, attach to session, see before/after. Works from BOTH entry points. Aha: "Same question, completely different answer. My agent knows my business."

No "Your First Agent" page — the reader already has an agent (the implicit assistant). Agent creation is introduced later when there's a reason to customize.

## Execution Plan: 4 Sessions

### Why 4 sessions

- Attempting everything in one session risks context exhaustion and quality degradation
- Dependencies form a chain: governance → prototype → content A → content B
- Each session produces a reviewable deliverable with a feedback checkpoint
- Sessions 1+2 or 3+4 can be combined if progress is smooth, but the default is to pause for feedback

---

### Session 1: Governance and Strategy

**Goal**: Establish principles and revise strategic documents BEFORE content or code changes.

#### 1A. Update document writer role (`_roles/002_document_writer.md`)

Add seven new principles under a new "## Getting Started and tutorial standards" section:

| Principle | What it means |
|-----------|---------------|
| **Narrative continuity** | Every Getting Started / Tutorial page opens by referencing what the reader accomplished on the previous page. Closes by motivating the next page with a concrete functional reason ("Your agent gives generic answers — let's fix that"). |
| **Aha-moment design** | Each tutorial identifies a specific emotional payoff. State it in "What you'll build." Deliver it in "What just happened." The payoff must be experienceable (the reader sees a different result), not just understandable. |
| **Progressive concept introduction** | One new concept per page. Don't explain what the reader doesn't need yet. If "Agent" becomes relevant later, defer it. Show the simplest interface first (create session, send message). |
| **Implicit defaults** | When Stigmer provides sensible defaults (e.g., the assistant agent), use them implicitly. Don't make the reader configure what works out of the box. Introduce configuration when there's a reason to customize. |
| **Cloud-primary, converging paths** | Cloud Quickstart is the primary entry. Local Quickstart is an alternative. After the initial quickstart, both paths converge into a single tutorial sequence. |
| **Embedded component standards** | Use real `@stigmer/react` components backed by demo fixtures. Never static screenshots. Prefer animated playback (ScenarioPlayer) over static final-state renders for multi-step interactions. |
| **Page bridging pattern** | Every page ends with a "Next step" that answers: (1) "What can't you do yet?" and (2) "What will the next page teach you?" The motivation is functional, not navigational. |

#### 1B. Revise information architecture (`design-decisions/information-architecture.md`)

Targeted edits (not a full rewrite):

- **Section 3, Getting Started**: Clarify that Cloud Quickstart scope is sign up → API key → SDK → session → message → response. No skill creation. The implicit assistant agent is used.
- **Section 3, Getting Started**: Clarify that Your First Skill works from both Cloud and Local entry points (remove the "Prerequisites: Local quickstart" constraint).
- **Section 5, Learning paths**: Add narrative continuity as a requirement — each page in a path must bridge to the next.

#### 1C. Create design decision: ScenarioPlayer approach

New file: `design-decisions/scenario-player.md` (in this sub-project)

Contents:
- Problem: Static demo components don't convey the journey
- Chosen approach: Stepped fixture delivery to real `@stigmer/react` components with CSS transition animations
- Technical sketch: `ScenarioPlayer` wrapper, `framer-motion` for animations, timed fixture delivery via modified `DemoTransport`
- No off-the-shelf library exists for this — the sequencing logic is custom (~100-150 lines), animation transitions use `framer-motion` (well-maintained, widely used)
- Prototype-first: build minimal version, get feedback, then full build

#### 1D. Fix docs sidebar

Remove Use Cases and GitHub from the docs navigation tree. These are marketing/external links that belong in the top nav only. Identify the Fumadocs configuration that controls this and remove them.

**Session 1 deliverable**: Updated document writer role, revised IA sections, ScenarioPlayer design decision, clean docs sidebar. All reviewable before Session 2.

---

### Session 2: ScenarioPlayer Prototype

**Goal**: Build a minimal, working prototype. Get feedback on feel before full build.

#### 2A. ScenarioPlayer component

Location: `site/src/components/docs/demos/ScenarioPlayer.tsx`

Behavior:
- Accepts a `DemoScenario` plus a `steps` timeline (array of { fixtureUpdates, delayMs })
- Each step reveals the next piece of UI (a new message, an artifact card, etc.)
- Uses `framer-motion` `AnimatePresence` for enter animations (fade-in + slide-up)
- Auto-plays on mount with a visible progress indicator
- "Replay" button to restart the animation
- Renders real `@stigmer/react` components at each step

#### 2B. Simple quickstart scenario

For prototyping only — a 2-3 message exchange:
1. User message appears (fade-in)
2. Pause (simulating thinking)
3. Assistant response streams in (or fades in as a block — we'll decide based on what feels right)

No artifacts yet. Just enough to evaluate: timing, transitions, "GIF-like" feel.

#### 2C. Embed for feedback

Temporarily embed in the existing Cloud Quickstart or a scratch page so it can be seen in the real docs context (fonts, colors, spacing).

**Session 2 deliverable**: Working ScenarioPlayer prototype embedded in docs. Feedback checkpoint before proceeding.

---

### Session 3: Cloud Quickstart + Docs Homepage

**Goal**: Rewrite the two pages that form the entry experience.

#### 3A. Rewrite Cloud Quickstart (`docs/getting-started/quickstart.mdx`)

Structure:
- **What you'll build**: "A working AI agent you can call from your code — in 5 minutes."
- **Step 1**: Sign up at app.stigmer.ai, get API key
- **Step 2**: Install SDK (tabs: TypeScript primary, Go, Python)
- **Step 3**: Create a session and send a message (SDK code — no agent specified, assistant is implicit)
- **Step 4**: See the response
- **Embedded ScenarioPlayer**: Message/response animation
- **What just happened**: You called an AI agent from your own code via a real API. The assistant agent handled your request — no configuration needed.
- **Next step (bridge)**: "Your agent gave a generic answer. It doesn't know your return policy, your product catalog, or your escalation process. Let's fix that. → Your First Skill"

#### 3B. Rewrite docs homepage (`docs/index.mdx`)

Structure:
- One-sentence orientation (from positioning)
- Journey preview: visual progression (Quickstart 5 min → Skill 10 min → Tools 15 min → Approvals 10 min)
- Two entry CTAs: "Start with Cloud" (primary), "Run Locally" (secondary)
- Jump links: Concepts, SDK Reference, CLI, API (for experienced users)

**Session 3 deliverable**: Rewritten Cloud Quickstart and docs homepage. Verified build passes.

---

### Session 4: Your First Skill + Local Quickstart

**Goal**: Complete the Getting Started story arc.

#### 4A. Rewrite Your First Skill (`docs/getting-started/first-skill.mdx`)

Structure:
- **Opening bridge**: "In the quickstart, you connected Stigmer and got a response. But the answer was generic — your agent doesn't know your business yet."
- **Step 1**: See the problem (ask a domain question, get a generic answer)
- **Step 2**: Create a skill (tabs: web console path + CLI path — works from both entry points)
- **Step 3**: Attach skill to a new session and ask again
- **Step 4**: See the expert answer
- **Full ScenarioPlayer**: Messages → response → artifact (SKILL.md) → content preview
- **Before/after comparison table** (existing, keep it)
- **Next step (bridge)**: "Your agent knows your domain. But it can only talk — it can't look up orders, create tickets, or take actions. → Give Your Agent Tools"

#### 4B. Adjust Local Quickstart (`docs/getting-started/local.mdx`)

- Reframe opening: "Prefer running Stigmer on your own machine? This gets you to the same place as the Cloud quickstart."
- Keep existing steps (brew install, server, YAML, apply, run)
- Add "What just happened" section
- Add "Next step" bridge pointing to Your First Skill

#### 4C. End-to-end verification

- Navigate full journey: Cloud Quickstart → Your First Skill → (future: Tools)
- Check narrative continuity, no dead ends, consistent terminology
- Verify build passes, TypeScript passes, no linter errors

**Session 4 deliverable**: Complete Getting Started documentation with connected story arc.

---

## What This Plan Does NOT Include

- **Phase 4 (Core Concepts) rewrite** — separate work, depends on this
- **"Your First Agent" page** — deferred. The implicit assistant handles the initial experience. Agent creation is a future tutorial topic.
- **Full tutorials (Tools, Approvals, Workflows)** — Phase 6, depends on Phase 5 sample app
- **Production polish of ScenarioPlayer** — built incrementally based on prototype feedback

## Success Criteria

1. A reader can follow Cloud Quickstart → Your First Skill as a connected story
2. Each page opens with context from the previous page and closes with motivation for the next
3. The Cloud Quickstart works without the reader creating or knowing about agents
4. Embedded ScenarioPlayer components show an animated playback of real product UI
5. The document writer role codifies all quality principles for future documentation
6. `yarn build` and `tsc --noEmit` pass after all changes
7. Docs sidebar contains only documentation pages (no marketing links)

## Review Process

1. **You review this plan** — consider sessions, approach, scope
2. **Provide feedback** — any changes
3. **I'll revise** — create T01_1_review.md and T01_2_revised_plan.md
4. **You approve** — explicit go-ahead
5. **Execution begins** — Session 1 first, with feedback checkpoints between sessions
