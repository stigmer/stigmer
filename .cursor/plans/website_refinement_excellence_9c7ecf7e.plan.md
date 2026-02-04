---
name: Website Refinement Excellence
overview: "Refine Stigmer website architecture section with technical precision: fix \"agent as microservice\" messaging, add dual-track code examples, remove redundancy, correct sandbox/MCP distinction, and polish visual alignment."
todos:
  - id: update-messaging
    content: Update 'Agent as Microservice' to 'Agents as gRPC Services' with revised description
    status: completed
  - id: add-dual-track-tabs
    content: Implement tabbed code viewer in 'You Write' section (YAML + Go SDK tabs)
    status: completed
  - id: split-infrastructure-layers
    content: Split Sandbox card into 'Sandbox Isolation' and 'MCP Security' as separate layers
    status: completed
  - id: expand-integration-example
    content: Expand 'You Integrate' Go code to show create → poll → retrieve workflow
    status: completed
  - id: remove-integration-section
    content: Remove Integration section from HomePage and delete Integration.tsx component
    status: completed
  - id: audit-visual-alignment
    content: Verify arrow alignment and spacing across all breakpoints (mobile/tablet/desktop)
    status: completed
  - id: quality-validation
    content: "Run all quality gates: typecheck, lint, build, visual QA, content voice test"
    status: completed
isProject: false
---

# Website Content Refinement - Technical Precision & Polish

## Context

Current website has 6 issues impacting clarity and technical credibility:

1. "Agent as Microservice" messaging implies deployment (incorrect)
2. "You Write" shows only YAML (misses dual-track positioning)
3. Duplicate "Platform vs Framework" sections (Architecture + Integration)
4. Sandbox isolation mislabeled as "MCP servers isolated"
5. "You Integrate" code example too minimal (single API call)
6. Potential arrow alignment issues in diagrams

## Technical Changes

### 1. Messaging Precision: "Agents as gRPC Services"

**File**: `[site/src/components/sections/Architecture.tsx](site/src/components/sections/Architecture.tsx)`

**Change**: Update "Agent as Microservice" layer card

- **Current**: "Agent as Microservice" / "Independent service with gRPC contract"
- **New**: "Agents as gRPC Services" / "Define once, call from anywhere via standard gRPC"

**Rationale**: Focuses on consumption pattern (developer value) vs deployment model (implementation detail). "Services" conveys the same architectural benefit without implying ops burden.

### 2. Dual-Track Code Display

**File**: `[site/src/components/sections/Architecture.tsx](site/src/components/sections/Architecture.tsx)`

**Add**: Tabbed code viewer in "You Write" column

- Tab 1: YAML (existing 5-line example)
- Tab 2: Go SDK (new - equivalent agent definition)
- Update subtitle: "YAML for speed, SDK for production" (was "5 lines. No infrastructure code.")

**Implementation**:

```tsx
// Add simple tab state management
const [activeTab, setActiveTab] = useState<'yaml' | 'sdk'>('yaml')

// Tab buttons UI
<div className="flex gap-2 mb-3">
  <button onClick={() => setActiveTab('yaml')}>YAML</button>
  <button onClick={() => setActiveTab('sdk')}>Go SDK</button>
</div>

// Conditional rendering
{activeTab === 'yaml' && <YAMLCode />}
{activeTab === 'sdk' && <GoSDKCode />}
```

**Rationale**: Visually proves Stigmer's differentiation (flexibility). Developers immediately see both paths.

### 3. Infrastructure Layer Accuracy

**File**: `[site/src/components/sections/Architecture.tsx](site/src/components/sections/Architecture.tsx)`

**Split Sandbox Layer**: Current "Sandbox Isolation" conflates two concepts

**Before** (1 card):

- Sandbox Isolation: "MCP servers isolated, file system controlled"

**After** (2 cards):

- **Sandbox Isolation**: "Isolated file system, controlled process execution"
- **MCP Security**: "Tool filtering, environment secrets"

**Rationale**: These are distinct security boundaries (OS-level vs application-level). Technical accuracy builds trust.

### 4. Complete Integration Example

**File**: `[site/src/components/sections/Architecture.tsx](site/src/components/sections/Architecture.tsx)`

**Expand Go code** in "You Integrate" column from single `Create()` call to realistic workflow:

```go
// Create execution
execution, err := client.Create(ctx, &AgentExecution{
    Spec: &AgentExecutionSpec{
        AgentId: "code-reviewer",
        Input: "Review PR #123",
    },
})

// Poll for completion
for {
    status, _ := client.GetStatus(ctx, execution.Id)
    if status.Phase == "COMPLETED" { break }
    time.Sleep(2 * time.Second)
}

// Retrieve result
result, _ := client.GetResult(ctx, execution.Id)
fmt.Println(result.Output)
```

**Rationale**: Developers think in workflows. Showing create-wait-retrieve pattern answers "what happens next?" - critical for mental model formation.

### 5. Remove Redundancy

**Files**: 

- `[site/src/components/pages/HomePage.tsx](site/src/components/pages/HomePage.tsx)`
- `[site/src/components/sections/Integration.tsx](site/src/components/sections/Integration.tsx)`

**Actions**:

1. Remove `<Integration />` from HomePage section order
2. Delete Integration.tsx component (no longer needed)
3. Verify no other files import Integration component

**New page structure**: Hero → Features → Architecture → Quickstart → Footer

**Rationale**: Architecture section supersedes Integration. One comprehensive section > two fragmented ones.

### 6. Visual Alignment Audit

**File**: `[site/src/components/sections/Architecture.tsx](site/src/components/sections/Architecture.tsx)`

**Check**:

- FlowArrow SVG viewBox and path coordinates
- Arrow positioning at breakpoints (mobile/tablet/desktop)
- Column alignment in 3-column grid
- Spacing consistency in PlatformLayerStack

**Test**: Visual QA at three viewport sizes (375px, 768px, 1280px)

## Quality Gates

All must pass before completion:

**Build**:

- `npm run typecheck` - zero errors
- `npm run lint` - zero errors
- `npm run build` - successful export

**Content**:

- 30-second test: Platform positioning clear immediately
- Voice test: Read all updated copy aloud (no AI fluff, precise language)
- Technical accuracy: All infrastructure claims verifiable

**Visual**:

- Arrow alignment verified at 3 breakpoints
- Code examples readable and properly formatted
- Tab interaction smooth (if implemented)

## Success Metrics

**Messaging Clarity**:

- "Agents as microservices" repositioned to consumer perspective
- Dual-track (YAML + SDK) visually proven
- Infrastructure layers technically accurate

**Developer Trust**:

- Complete code examples (workflow, not isolated calls)
- Precise language (no deployment vs consumption confusion)
- Zero redundancy (clean information architecture)

**Visual Polish**:

- Professional diagram alignment
- Consistent spacing/typography
- Responsive at all breakpoints

