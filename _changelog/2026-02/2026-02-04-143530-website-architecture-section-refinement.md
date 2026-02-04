# Website Architecture Section Refinement and Code Accuracy

**Date**: February 4, 2026

## Summary

Completely overhauled the "How It Works" architecture section on the Stigmer website to fix code accuracy issues, improve visual balance, and create a cohesive user experience. The section now accurately demonstrates Stigmer's SDK patterns and gRPC integration with properly aligned, scannable code examples.

## Problem Statement

The architecture section had several critical issues that impacted user understanding and trust:

### Pain Points

- **Incorrect SDK code**: Showed gRPC client types instead of Stigmer's Pulumi-style SDK patterns
- **Wrong integration pattern**: Displayed polling loops instead of Stigmer's streaming RPC architecture  
- **Visual imbalance**: Three columns had drastically different content heights, creating awkward white space
- **Code overflow**: Examples were too verbose, causing text to be cut off
- **Layout misalignment**: Columns weren't properly centered within the page container
- **Missing arrows**: Flow indicators were removed during fixes, breaking the visual narrative

## Solution

Implemented a comprehensive fix addressing all issues while maintaining visual consistency:

1. **Corrected SDK examples**: Replaced incorrect gRPC types with real Stigmer SDK patterns from `sdk/go/agent/`
2. **Fixed integration code**: Changed from polling to streaming `Subscribe()` RPC pattern
3. **Balanced column heights**: Added contextual feature badges to shorter columns
4. **Optimized code size**: Reduced examples to 7-15 lines with smaller fonts (11px) and tighter spacing
5. **Restored proper layout**: Fixed flexbox alignment with centered columns and arrows
6. **Simplified comparison diagram**: Redesigned Platform vs Framework section with clear hub-and-spoke pattern

## Implementation Details

### Code Accuracy Fixes

**YAML example** (unchanged - already correct):
```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
spec:
  instructions: "Review code"
  mcpServers: [github]
```

**Go SDK example** (fixed to match real SDK):
```go
stigmer.Run(func(ctx *stigmer.Context) error {
  a, _ := agent.New(ctx, "code-reviewer", 
    &agent.AgentArgs{
      Instructions: "Review code",
    })
  a.UseMCP("stigmer/github")
  return nil
})
```

**Integration example** (fixed to show streaming):
```go
// Execute agent
exec, _ := client.Create(ctx, 
  &AgentExecution{
    AgentId: "code-reviewer",
    Message: "Review PR #123",
  })

// Stream updates
stream, _ := client.Subscribe(ctx, exec.Id)
for {
  resp, _ := stream.Recv()
  if resp.Phase == "COMPLETED" { break }
}
```

### Layout Improvements

**Column structure**:
- Fixed widths: 320px (left), 280px (center), 320px (right)
- Flex layout with `justify-center` for proper page centering
- Arrows positioned at `pt-16` for consistent visual flow
- Gap reduced from `gap-6` to `gap-4` for better density

**Content balancing**:
- Added 3 feature badges per tab (YAML vs SDK) in left column
- Badges show contextual benefits (e.g., "No Build Step" for YAML, "Type Safety" for SDK)
- Maintains visual balance across all three columns

**Code optimization**:
- Reduced font size: `text-[11px]` with `leading-relaxed`
- Reduced padding: `p-3` instead of `p-4`
- Shortened variable names: `a` instead of `agent`, `exec` instead of `execution`
- Condensed strings: "Review code" instead of "Review code for security"

### Platform Comparison Fix

Changed from confusing stacked layout to clear horizontal hub-and-spoke:

```
[App 1] → [Agent Service] ← [App 2]
```

This clearly shows both apps connecting to a central service, reinforcing the platform message.

## Benefits

1. **Technical Accuracy**: Developers now see real, copy-pastable SDK patterns
2. **Trust Building**: Correct code examples demonstrate deep product knowledge
3. **Visual Cohesion**: Balanced columns create professional, polished appearance
4. **Scannability**: Concise examples allow quick pattern recognition
5. **Clear Messaging**: Proper arrows and layout reinforce the "platform, not framework" story
6. **Responsive Design**: Layout adapts gracefully to different screen sizes

## Impact

**Target Audience**: Developers evaluating Stigmer for agentic platform needs

**User Experience Improvements**:
- Faster comprehension of Stigmer's architecture
- Accurate mental model of SDK vs gRPC integration
- Clear understanding of platform benefits vs framework approach
- Professional impression that builds confidence in product maturity

**Development Impact**:
- Verified all code examples against actual codebase (`sdk/go/examples/`, `client-apps/cli/`)
- Established pattern for pedagogically simplified but technically accurate website code
- Created reusable approach for balancing column content

## Related Work

This work complements recent website improvements:
- Hero section refinement
- Features section visual polish
- Quickstart guide enhancements
- Overall brand consistency improvements

## Technical Details

**Files Modified**:
- `site/src/components/sections/Architecture.tsx` (103 insertions, 84 deletions)

**Key Components Updated**:
- `CodeTabViewer`: Now shows YAML/SDK toggle with contextual feature badges
- `CodeSnippetCard`: Optimized for smaller, more readable code blocks
- `IntegrationCard`: Fixed to show streaming RPC pattern
- `PlatformComparisonVisual`: Redesigned diagram layout
- `ArchitectureDiagram`: Fixed flex layout and arrow positioning

**Design Principles Applied**:
- Landing page code should be pedagogically simplified but technically accurate
- Industry standard: Show real patterns (Temporal, Hasura, Pulumi style)
- Visual balance trumps code completeness for landing pages
- Arrows must connect logically and align visually

---

**Status**: ✅ Production Ready  
**Timeline**: Single session (~2 hours)
