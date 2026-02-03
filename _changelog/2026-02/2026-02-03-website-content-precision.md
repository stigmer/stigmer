# Website Content Precision & Messaging Overhaul

**Date**: 2026-02-03  
**Type**: Content & Messaging  
**Impact**: High - Core positioning and technical accuracy fixes

## Summary

Critical content accuracy and messaging improvements based on founder feedback. Repositioned Stigmer with "Agents as Microservices" as the core differentiator, removed misleading claims about Python SDK and SQLite, consolidated features from 7 to 6 cards, and updated all integration examples to use actual proto definitions.

## Strategic Changes

### 1. Core Positioning Shift

**Before**: "Build Agents, Integrate Anywhere"  
**After**: "Agents as Microservices"

**Rationale**: "Agents as Microservices" is THE primary differentiator vs frameworks (LangChain/CrewAI). It's a mental model developers instantly understand (like Stripe/Twilio APIs).

### 2. Voice Refinement

- **Removed defensive language**: No more "no trap", "no lock-in", "we earn your business"
- **Removed license marketing**: Changed "Apache 2.0" badge to "Open Source"
- **Positive framing only**: States capabilities, doesn't defend against non-existent threats

## Content Changes

### Hero Section

**Removed:**
- Centered logo (non-standard pattern, wastes prime real estate)
- "Apache 2.0" badge (license names don't belong in marketing)
- "No vendor lock-in" defensive language

**Added:**
- "Agents as Microservices" headline (core differentiator)
- "Open Source" badge (simple, confident)
- Cleaner subheadline emphasizing deployment independence

**New Structure:**
```
Badges: [gRPC APIs] [YAML + SDK] [Open Source]
Headline: "Agents as Microservices"
Subheadline: "Build agents in YAML or Go. Deploy once. Call from everywhere via gRPC. 
Update agents independently—all consumers benefit instantly."
```

### Features Section (7 → 6 Cards)

**Merged Cards:**
- "Production Infrastructure, Day One" + "Type-Safe When You Need It" → "Production-Grade Stack"
- New description honestly distinguishes local dev (SQLite) vs Stigmer Cloud (managed infrastructure)

**Removed:**
- Python SDK mentions (not built yet)
- "Test in CI/CD" filler line (obvious, adds no value)
- "119 public proto files" hardcoded count (will become stale)
- "Apache 2.0 licensed" from open source card

**Updated Cards:**

1. **Start Simple, Scale Naturally**
   - Changed: "Go/Python SDK" → "Go SDK"
   - Removed: Python SDK reference

2. **One Command, Zero Config**
   - Changed: "BadgerDB" → "SQLite for local dev"
   - More accurate about what `stigmer server` actually sets up

3. **Production-Grade Stack** (NEW - merged #3 and #5)
   - Combined infrastructure + SDK messaging
   - Honest about local (SQLite) vs cloud (managed) distinction
   - Emphasizes patterns over specific tech

4. **Bring Your Own AI**
   - Removed: "No vendor lock-in, no forced dependencies" (defensive)
   - Kept: Positive framing of model flexibility

5. **Fully Open Source** (renamed from "Truly Open Source")
   - Removed: "Apache 2.0 licensed", "no open core trap", "No lock-in, ever"
   - Added: "Build on Stigmer, extend Stigmer, or learn from Stigmer"
   - Changed: "119 public proto files" → "Public gRPC contracts at github.com/stigmer/stigmer/apis/"

6. **Integrate Agents Anywhere**
   - Removed: Redundant proto URL (now in #5)
   - Kept: Clear microservices messaging

### Quickstart Section

**Step 5 (Integration Example):**

**Before:**
- Showed both Go and Python examples
- Used placeholder proto paths: `github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agent/v1`

**After:**
- Shows ONLY Go example with ACTUAL proto paths
- Uses real AgentExecution protos: `ai/stigmer/agentic/agentexecution/v1`
- Added footnote: "Python gRPC client example in docs (standard grpc-tools). Native Python SDK in active development—track progress on GitHub."

**Real Proto Example:**
```go
import agentexec "github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agentexecution/v1"
import "github.com/stigmer/stigmer/apis/ai/stigmer/commons/apiresource"

client := agentexec.NewAgentExecutionCommandControllerClient(conn)
execution, err := client.Create(ctx, &agentexec.AgentExecution{
    Metadata: &apiresource.ApiResourceMetadata{
        OrganizationId: "your-org",
    },
    Spec: &agentexec.AgentExecutionSpec{
        AgentId: "code-reviewer",
        Input: "Review PR #123",
    },
})
```

**SDK Callout:**
- Changed title: "Go or Python SDK" → "Go SDK"
- Added: "Python SDK in active development. Python developers can call agents via gRPC today using standard grpc-tools."

### Integration Section

**Updated intro paragraph:**
- Changed: "Create agents once, integrate them everywhere via gRPC"
- To: "Agents run as independent microservices with gRPC APIs"
- Emphasizes microservices architecture pattern upfront

## Technical Accuracy Fixes

| Issue | Before | After |
|-------|--------|-------|
| **Python SDK** | Listed as available | Clear it's in development, gRPC available today |
| **SQLite** | "Production infrastructure" | "Local dev" (Stigmer Cloud has managed infra) |
| **BadgerDB** | Mentioned in features | Removed (was SQLite all along) |
| **Proto count** | "119 public protos" | URL to actual proto directory |
| **License marketing** | "Apache 2.0" badge | "Open Source" badge |
| **Integration examples** | Placeholder paths | Actual proto package paths |

## Files Changed

1. **site/src/lib/constants.ts**
   - Updated `SITE_CONFIG.tagline`: "Agents as Microservices"
   - Updated `SITE_CONFIG.description`: Removed Python SDK, license mentions
   - Rewrote `FEATURES` array: 7 → 6 cards with accurate descriptions

2. **site/src/components/sections/Hero.tsx**
   - Removed centered logo section (lines 78-81)
   - Updated headline and subheadline
   - Changed badges: Apache 2.0 → Open Source
   - Removed unused StigmerLogo import

3. **site/src/components/sections/Quickstart.tsx**
   - Replaced placeholder proto paths with actual AgentExecution protos
   - Removed Python integration example
   - Added Python SDK roadmap footnote
   - Updated SDK callout to Go-only

4. **site/src/components/sections/Integration.tsx**
   - Strengthened microservices messaging in intro paragraph

## Build Validation

- ✅ TypeScript type checking: PASSED
- ✅ ESLint: PASSED (after removing unused import)
- ✅ Next.js build: PASSED
- ✅ Static export: PASSED (125 kB First Load JS)

## Success Criteria Validation

1. **Positioning Test**: ✅ "Agents as Microservices" is clear in hero, instantly differentiates from frameworks
2. **Honesty Test**: ✅ Zero misleading claims about Python SDK or SQLite production use
3. **Technical Test**: ✅ Integration examples use actual proto paths developers can verify
4. **Layout Test**: ✅ 6-card grid has clean 3x2 appearance (no empty cells)
5. **Differentiation Test**: ✅ Platform vs framework positioning obvious
6. **Voice Test**: ✅ No defensive language, positive messaging only

## Impact

**User Experience:**
- Clearer positioning (platform vs framework)
- Honest expectations (Go SDK ready, Python in development)
- Verifiable code examples (actual proto paths)

**Technical Accuracy:**
- Developers can copy-paste integration examples and run them
- No misleading claims about production infrastructure
- Python developers have clear path forward (gRPC today, SDK later)

**Brand:**
- Confident, positive messaging
- No defensive language
- Professional, founder-led voice

## Migration Notes

None - content changes only, no breaking changes to code or APIs.

## Related Issues

- Founder feedback session: 2026-02-03
- Previous phase: Phase 4.1 (Content Excellence)
- Design decision: DD01_infrastructure_first_messaging.md

---

**Reviewed by**: Founder  
**Approved**: 2026-02-03  
**Deployed**: Pending
