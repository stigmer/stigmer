# Website Content Polish: Code-First Messaging for Engineering Teams

**Date**: February 3, 2026

## Summary

Completed comprehensive rewrite of the Stigmer website homepage to communicate a clear code-first value proposition targeting engineering teams. Repositioned from generic "AI-Powered Workflow Automation" to "Agentic Workflows as Code" with emphasis on Dual-Track architecture (YAML for experiments, SDK for production), technical credibility (Temporal, BadgerDB, gRPC), and engineer-centric messaging.

## Problem Statement

The original website content suffered from several critical issues that prevented effective communication to the target audience:

### Pain Points

- **Generic positioning**: "AI-Powered Workflow Automation" could describe any competitor product
- **Buried differentiation**: The Dual-Track architecture (YAML + SDK) wasn't surfaced
- **Missing audience signal**: No clear indication this is for engineers who write code (vs business users)
- **Wrong commands**: Showed `go install` and `stigmer local` (outdated CLI commands)
- **Weak credibility**: Didn't cite technical foundations (Temporal, BadgerDB, gRPC)
- **License error**: Listed "MIT License" instead of actual "Apache 2.0"
- **Feature-focused**: Listed features without conveying outcomes or superpowers
- **No progression path**: Didn't show how users graduate from YAML to SDK as complexity grows

## Solution

Implemented a messaging framework that follows the "Hair on Fire → Intellectual Insight → Aha Moment" structure:

1. **Hair on Fire**: Engineers want code-first workflow control, not visual drag-and-drop
2. **Intellectual Insight**: BPMN/visual tools were designed for business analysts, not engineers
3. **Aha Moment**: Stigmer gives you both - YAML for quick experiments, SDK for production systems

Applied this framework across all homepage sections with specific positioning:
- **Implicit contrast** to visual tools (language: "version control", "code review", "CI/CD")
- **Technical credibility** through specific tech stack mentions
- **Dual-Track architecture** as core differentiator
- **Engineer respect** through precise language and architectural transparency

## Implementation Details

### 1. Constants File (`site/src/lib/constants.ts`)

**Changes:**
- Tagline: "AI-Powered Workflow Automation" → "Agentic Workflows as Code"
- Description: Rewritten to emphasize YAML/SDK choice, zero infrastructure, Temporal foundation
- License: Fixed "MIT License" → "Apache 2.0"
- All 6 features completely rewritten with outcome-focused descriptions:
  1. "YAML or SDK - Your Choice" (was "YAML-First Workflows")
  2. "Zero Infrastructure to Start" (was "Powerful CLI")
  3. "Built on Production-Grade Foundations" (was "Any AI Model")
  4. "Use Any AI Model" (kept but refined)
  5. "Type-Safe Programmatic Control" (was "Type-Safe SDK")
  6. "Truly Open Source" (was "Open Source" with wrong license)

### 2. Hero Section (`site/src/components/sections/Hero.tsx`)

**Changes:**
- Headline: Simplified to single gradient line "Agentic Workflows as Code"
- Subheadline: "Define agents and workflows in YAML or Go/Python SDKs. Run locally with zero setup. Scale to cloud without code changes."
- Install command: `go install github.com/stigmer/stigmer/cmd/stigmer@latest` → `brew install stigmer/tap/stigmer`
- Post-install note: "Requires Go 1.21 or later" → "Start building: `stigmer server`"
- Badges: "Open Source", "CLI-First", "Any AI Model" → "Apache 2.0", "Built on Temporal", "YAML + SDK"

### 3. Features Section (`site/src/components/sections/Features.tsx`)

**Changes:**
- Section headline: "Everything you need to build" → "Built for engineering teams who code"
- Added subheadline: "Stigmer provides the flexibility you need: YAML for quick experiments, SDKs for complex production workflows. Version control everything. Review like infrastructure. Test in CI/CD."
- Feature cards automatically updated from constants with new technical messaging

### 4. Quickstart Section (`site/src/components/sections/Quickstart.tsx`)

**Complete rewrite:**
- Headline: "Get started in seconds" → "From zero to running agent in 60 seconds"
- Subheadline: Added specifics "Install, start server, create agent, run. No configuration, no complexity."
- Changed from 3 steps to 4 steps with correct flow:
  1. Install (Homebrew, not go install)
  2. Start server (`stigmer server`, not `stigmer local`)
  3. Create agent (5-line YAML example with real apiVersion)
  4. Run agent (`stigmer agent run code-reviewer "Review PR #123"`)
- Added SDK callout box: Explains when to use Go/Python SDKs with bullet points on benefits

## Benefits

### For Marketing/Product Positioning
- Clear differentiation from visual workflow tools and other AI frameworks
- Establishes technical credibility with senior engineers and architects
- Shows flexibility (YAML for simple, SDK for complex) that competitors lack

### For Developer Experience
- Correct CLI commands prevent user confusion and failed first-time setup
- 60-second quickstart creates immediate "wow" moment
- Clear progression path from YAML experiments to SDK production systems

### For Community Growth
- Apache 2.0 license correction removes confusion about true open source nature
- Engineer-centric messaging attracts right audience (platform engineers, staff engineers, architects)
- Technical transparency (citing Temporal, BadgerDB, gRPC) builds trust

## Impact

### User-Facing Changes
- Every visitor to stigmer.ai will see the new code-first positioning
- First-time users will follow corrected installation and quickstart flow
- Developers will understand the YAML → SDK graduation path

### Internal Benefits
- Consistent messaging foundation for future marketing materials
- Clear differentiation strategy for positioning vs competitors
- Content validated against 6 tests: clarity, differentiation, outcome, respect, proof, code-first

### Stakeholder Impact
- **Engineering teams**: Clear signal this is built for them, not business analysts
- **Open source community**: Correct Apache 2.0 license messaging
- **Enterprise evaluators**: Technical credibility through Temporal/BadgerDB/gRPC citations

## Content Validation

All content was validated against these tests:
1. **Clarity Test**: ✅ Can developer scan in 5 seconds and understand value?
2. **Differentiation Test**: ✅ Could this work for a competitor? (No - highly specific)
3. **Outcome Test**: ✅ Promises results, not just features?
4. **Respect Test**: ✅ Treats reader as smart engineer?
5. **Proof Test**: ✅ Cites real tech (Temporal, BadgerDB, gRPC)?
6. **Code-First Test**: ✅ Every section signals "for engineers who write code"?

## Related Work

This content polish supports the broader CLI architecture work documented in:
- `_projects/2026-01/20260131.02.cli-agent-yaml-first/` - Dual-Track architecture implementation
- Recent CLI command changes (`stigmer server` replacing `stigmer local`)
- Agent YAML-first implementation (enabling the 5-line agent examples)

## Files Changed

```
site/src/lib/constants.ts                          | 48 lines changed
site/src/components/sections/Hero.tsx              | 21 lines changed
site/src/components/sections/Features.tsx          |  6 lines changed
site/src/components/sections/Quickstart.tsx        | 91 lines changed
─────────────────────────────────────────────────────────────────────
Total: 4 files, 166 lines changed (75 insertions, 43 deletions, 48 modifications)
```

## Next Steps

### Immediate (Production Deployment)
1. Merge this branch to main
2. Deploy static site to GitHub Pages
3. Verify https://stigmer.ai shows updated content
4. Monitor analytics for engagement changes

### Follow-up (Content Expansion)
1. Apply same messaging framework to documentation pages
2. Create /docs landing page with consistent positioning
3. Update README.md with aligned messaging
4. Create case studies showing YAML → SDK progression

### Marketing Amplification
1. Blog post: "Why We Built Workflows-as-Code for Engineers"
2. Social media campaign highlighting Dual-Track architecture
3. Technical talk: "From BPMN to Code: Workflow Automation for Modern Teams"

---

**Status**: ✅ Production Ready
**Timeline**: 2 hours (content strategy → implementation → validation)
**Commit**: 274e84f - feat(site): rewrite homepage content with code-first messaging
