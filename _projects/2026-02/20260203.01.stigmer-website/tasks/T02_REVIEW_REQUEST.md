# Phase 4 Review Request: Content Overhaul

**Status**: 📝 AWAITING FOUNDER APPROVAL  
**Created**: 2026-02-03 20:15  
**Review Time**: ~10 minutes

---

## TL;DR

I've translated your voice note insights into a comprehensive content overhaul plan. The core pivot:

**FROM**: "Agentic Workflows as Code" (format-focused)  
**TO**: "Build Agents Without Fighting Infrastructure" (value-focused)

---

## What I Captured from Your Voice Note

### Your Core Realization
> "Building agents is nothing but configurations to be given... Planton should not worry about how agent creation should work. I should simplify agent creation."

**Translation**: 80% of agent building is infrastructure plumbing. Stigmer solves that so developers can focus on agent logic.

### Your Evolution Story
1. **v1**: Agent = instructions + MCP + sub-agents
2. **v2**: Added skills (composability)
3. **v3**: Added sandboxing (security)
4. **v4**: Added workflows (founder request for static + agent steps)
5. **v5**: Added SDK (because YAML was hard even for you)

**Translation**: This progression IS the proof that infrastructure complexity is the real problem.

### Your Honest Moment
> "YAML felt so difficult to write, even me who created it felt it difficult to write."

**Translation**: This vulnerability builds trust. SDK isn't a "nice to have" - it's a necessity.

---

## Proposed Changes at a Glance

### Hero Section
- **Headline**: "Build Agents Without Fighting Infrastructure"
- **Subheadline**: Lists specific problems solved (sandboxing, orchestration, MCP, scaling)
- **Logo**: Replace placeholder "S" with official logo (found at stigmer-cloud/docs/logo.svg ✅)

### Features Section
- **Title**: "Infrastructure You Don't Have to Build"
- **Reframe**: All 6 features as "problems you don't solve" instead of "capabilities"

### New Section: Evolution Story
- **Add**: v1→v5 table showing what was built and why
- **Purpose**: Credibility through lived experience (not theory)

### New Section: "Why Stigmer?"
- **Add**: Comparison showing time savings (2 weeks → 30 seconds)
- **Tone**: Respectful, not arrogant ("We spent the time so you don't have to")

---

## Three Documents to Review

### 1. Main Plan (15 min read)
**File**: `tasks/T02_0_content_overhaul_plan.md`

Contains:
- Complete content rewrite specifications
- Implementation checklist (3 phases: 4.1, 4.2, 4.3)
- Open questions for your input

### 2. Before/After Comparison (10 min read)
**File**: `tasks/T02_1_messaging_comparison.md`

Contains:
- Side-by-side current vs proposed messaging
- Voice examples showing tone shifts
- Validation against your "Chief Product Evangelist" framework

### 3. Design Decision (5 min read)
**File**: `design-decisions/DD01_infrastructure_first_messaging.md`

Contains:
- Rationale for "infrastructure-first" positioning
- Trade-offs analysis (what we lose/gain)
- Success metrics for validation

---

## Quick Approval Checklist

Review and approve/modify:

- [ ] **Headline**: "Build Agents Without Fighting Infrastructure"
  - Alternative if too long: "Build Agents, Not Infrastructure"
  
- [ ] **Evolution Story**: v1→v5 table inclusion (shows Planton learnings)
  - Concern: Could feel like chest-thumping?
  - Mitigation: Humble tone ("We learned by building")
  
- [ ] **Planton Mentions**: Currently moderate prominence
  - Increase? Add case study section?
  - Decrease? Keep as subtle proof points?
  
- [ ] **Tone**: "We figured it out so you don't have to"
  - Too informal?
  - Alternative: "We spent 2 years building Planton. We learned what works."
  
- [ ] **Logo**: Use stigmer-cloud/docs/logo.svg (95×96px, gradient with pattern)
  - Correct file?
  - Any variants (light/dark mode)?

---

## What Happens After Approval

### Phase 4.1: Content Rewrite (1 session, ~2 hours)
1. Rewrite Hero section (headline, subheadline, badges)
2. Rewrite Features section (title + all 6 features)
3. Create Evolution Story section (v1→v5 table)
4. Create "Why Stigmer?" comparison section
5. Update site metadata in constants.ts

### Phase 4.2: Brand Assets (1 session, ~1 hour)
1. Copy logo.svg to site/public/
2. Replace placeholder logo in components
3. Generate favicon from logo
4. Test all logo variants (sm/md/lg)

### Phase 4.3: Polish & Deploy (1 session, ~1 hour)
1. Validate against 6 content criteria
2. Zero linter errors
3. Build and verify static export
4. Deploy to production

**Total Time**: ~4 hours across 3 sessions

---

## My Recommendation

**Approve with modifications** on:
1. **Tone**: Soften "We figured it out" to "We learned by building" (more humble)
2. **Planton**: Keep moderate (proof point, not hero)
3. **Evolution Story**: Include it - this IS your credibility

**Proceed as-is** on:
1. **Headline**: "Build Agents Without Fighting Infrastructure" (clear value)
2. **Logo**: Use stigmer-cloud/docs/logo.svg
3. **Features Reframe**: "Infrastructure You Don't Have to Build"

---

## How to Provide Feedback

**Option 1: Quick Approval**
> "Looks good, proceed with your recommendations"

**Option 2: Modifications**
> "Change [X] to [Y], then proceed"

**Option 3: Detailed Review**
> "Let me review all three docs first, hold on implementation"

---

## Open Questions Needing Your Input

1. **Logo Variants**: Do we have light/dark mode versions? Or one universal logo?
2. **Planton Link**: Should we link to plantoncloud.com or keep it as text-only mention?
3. **Technical Diagram**: Add architecture diagram showing Temporal/BadgerDB/gRPC stack?
4. **Skills Platform Feature**: Should we tease "agents creating skills" as future capability?

---

## Current Website Status

**Phase 3 Completed**: Code-first messaging with working site
- ✅ Next.js 15 infrastructure
- ✅ 30 files, zero linter errors
- ✅ 124 kB First Load JS
- ✅ GitHub Actions deployment ready

**Phase 4 Ready**: Content overhaul can deploy immediately after completion
- Deployment: Push to main → auto-deploy to stigmer.ai
- Risk: Low (content changes only, no structural changes)

---

**Awaiting Your Review**

When you're ready, I'll execute Phase 4 (4.1 → 4.2 → 4.3) and deploy.

---

## Quick Links

- Main Plan: `_projects/2026-02/20260203.01.stigmer-website/tasks/T02_0_content_overhaul_plan.md`
- Comparison: `_projects/2026-02/20260203.01.stigmer-website/tasks/T02_1_messaging_comparison.md`
- Design Decision: `_projects/2026-02/20260203.01.stigmer-website/design-decisions/DD01_infrastructure_first_messaging.md`
- Project Status: `_projects/2026-02/20260203.01.stigmer-website/next-task.md`
