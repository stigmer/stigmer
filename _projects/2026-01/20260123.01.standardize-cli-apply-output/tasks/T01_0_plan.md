# Task T01: Design and Implement CLI Apply Tabular Output

**Created**: 2026-01-23 03:07
**Status**: PENDING REVIEW
**Type**: Feature Development

⚠️ **This plan requires your review before execution**

## Objective

Design and implement a professional tabular display for the `stigmer apply` command output, inspired by Pulumi's resource table format. This will replace the current plain text output with a structured table showing:
- Resource Type (Agent, Workflow, Skill)
- Resource Name/Slug
- Operation (Create, Update, Delete)
- Status (✓ Success, ✗ Failed, ⟳ In Progress)
- Resource ID

## Current State Analysis

### Existing Implementation
1. **Current Apply Output** (`client-apps/cli/cmd/apply/...`)
   - Plain text messages: "Deployment successful"
   - No structured output
   - Resource details scattered in logs

2. **E2E Test Parsing** (`test/e2e/basic_agent_apply_test.go`)
   - Tests query backend API directly by slug
   - Don't rely on CLI output for IDs (good!)
   - Look for text: "Deployment successful", "code-reviewer"

### Pulumi's Approach
From `pulumi/pkg/backend/display/progress.go`:
- Uses `ProgressDisplay` with `progressRenderer` interface
- Interactive (terminal) vs non-interactive modes
- Tracks resources in `eventUrnToResourceRow` map
- Updates rows dynamically during operations
- Final summary table at completion

## Task Breakdown

### Phase 1: Research & Design (30 min)

1. **Analyze Pulumi's Table Rendering**
   - [x] Read `pulumi/pkg/backend/display/progress.go`
   - [ ] Identify key components: Row, ResourceRow, progressRenderer
   - [ ] Understand interactive vs non-interactive rendering
   - [ ] Note color/formatting utilities

2. **Survey Go Table Libraries**
   - [ ] Evaluate options:
     - `github.com/olekukonko/tablewriter` (popular, feature-rich)
     - `github.com/jedib0t/go-pretty/v6/table` (modern, colorful)
     - Build custom (like Pulumi) using terminal control
   - [ ] Decision criteria: simplicity, color support, alignment

3. **Design Output Format**
   - [ ] Define table columns:
     ```
     TYPE       NAME              STATUS    ID                    
     ──────────────────────────────────────────────────────────────
     Agent      code-reviewer     ✓ Created agent_abc123...       
     Agent      code-reviewer-pro ✓ Created agent_def456...       
     ```
   - [ ] Handle errors/warnings in table
   - [ ] Summary line: "Applied 2 agents (0 failed)"

### Phase 2: Implementation (2-3 hours)

1. **Create Display Package**
   - [ ] Location: `client-apps/cli/pkg/display/` (reusable utility)
   - [ ] Files:
     - `table.go` - Table builder interface
     - `apply_output.go` - Apply-specific formatter
     - `colors.go` - Color/emoji utilities
   
2. **Core Components**
   ```go
   // ApplyResultTable tracks resources applied
   type ApplyResultTable struct {
       Resources []AppliedResource
   }
   
   type AppliedResource struct {
       Type   ResourceType  // Agent, Workflow, Skill
       Name   string
       Status ApplyStatus   // Created, Updated, Failed
       ID     string
       Error  error         // if Status == Failed
   }
   
   func (t *ApplyResultTable) AddResource(...)
   func (t *ApplyResultTable) Render() string
   ```

3. **Integration with Apply Command**
   - [ ] Update `client-apps/cli/cmd/apply/apply.go` (or relevant file)
   - [ ] Pass `ApplyResultTable` through apply logic
   - [ ] Populate table as resources are applied
   - [ ] Render table at end of apply

4. **Handle Different Resource Types**
   - [ ] Agent apply → add to table
   - [ ] Workflow apply → add to table
   - [ ] Skill apply → add to table
   - [ ] Future: other resource types

### Phase 3: Testing & Validation (1 hour)

1. **Update E2E Tests**
   - [ ] Verify table output contains expected text
   - [ ] E2E tests continue to query by slug (no breaking changes)
   - [ ] Add new assertions for table format
   - [ ] Example:
     ```go
     s.Contains(output, "TYPE")
     s.Contains(output, "Agent")
     s.Contains(output, "✓ Created")
     ```

2. **Manual Testing**
   - [ ] Test with `testdata/examples/01-basic-agent/`
   - [ ] Verify colors in terminal
   - [ ] Test dry-run output
   - [ ] Test error scenarios (failed apply)

3. **Edge Cases**
   - [ ] Empty apply (no resources)
   - [ ] Partial failure (2 succeed, 1 fails)
   - [ ] Very long resource names (truncation)

### Phase 4: Polish & Documentation (30 min)

1. **Code Quality**
   - [ ] Follow Stigmer CLI coding guidelines
   - [ ] Add godoc comments
   - [ ] Clean up imports

2. **Documentation**
   - [ ] Update apply command help text (if needed)
   - [ ] Add comments explaining table format
   - [ ] Document color/emoji choices

## Implementation Details

### Table Library Decision

**Recommended**: `github.com/olekukonko/tablewriter`
- ✅ Stable, well-maintained (18k+ stars)
- ✅ Simple API for basic tables
- ✅ Color support via terminal codes
- ✅ Auto-sizing columns
- ❌ Slightly less modern than go-pretty

**Alternative**: `github.com/jedib0t/go-pretty/v6/table`
- ✅ More modern, actively maintained
- ✅ Rich color/style options
- ✅ Box drawing characters
- ❌ Slightly more complex API

**Decision**: Start with `tablewriter`, can swap if needed.

### Color Scheme

Based on Pulumi's approach:
- ✅ Green checkmark for success
- ❌ Red X for failures
- ⟳ Yellow spinner for in-progress (future: streaming)
- Gray for resource IDs (less emphasis)

### Output Format Example

```bash
$ stigmer apply --config ./examples/01-basic-agent

Applying resources...

TYPE       NAME              STATUS        ID                    
────────────────────────────────────────────────────────────────
Agent      code-reviewer     ✓ Created     agent_abc123...       
Agent      code-reviewer-pro ✓ Created     agent_def456...       

✅ Successfully applied 2 resources (0 failed)
```

### Dry Run Output

```bash
$ stigmer apply --config ./examples/01-basic-agent --dry-run

Dry run: The following resources would be applied:

TYPE       NAME              ACTION        
─────────────────────────────────────────
Agent      code-reviewer     Create       
Agent      code-reviewer-pro Create       

💡 Dry run successful - no resources were deployed
```

## Success Criteria

- [x] Table displays with proper columns and alignment
- [x] Colors work in terminal (green ✓, red ❌)
- [x] Resource IDs are included and visible
- [x] Dry run shows a modified table format
- [x] E2E tests pass without modification (backward compatible)
- [x] New table assertions added to tests
- [x] Code follows Stigmer CLI guidelines

## Risk Mitigation

### Risk 1: Breaking E2E Tests
**Mitigation**: Tests already query by slug via API, not CLI output parsing. Output format change won't break tests.

### Risk 2: Performance with Many Resources
**Mitigation**: Start simple. Table rendering is fast. Optimize if needed for 100+ resources.

### Risk 3: Terminal Compatibility
**Mitigation**: Use standard ANSI codes. Fallback to plain text if terminal doesn't support colors.

## Next Task Preview

**T02: Extend to Workflow/Skill Resources** - Apply the same table format to workflow and skill apply operations (if not already covered in T01).

**T03: Add Streaming Progress (Future)** - Real-time table updates during apply (like Pulumi's progress view).

## Questions for Review

1. **Table Library**: Do you prefer `tablewriter` or `go-pretty/table`? Or build custom?
2. **Color Scheme**: Green ✓, Red ❌, Yellow ⟳ - any preferences?
3. **ID Display**: Show full ID or truncated? (e.g., `agent_abc123...` vs `agent_abc1234567890`)
4. **Dry Run**: Should dry-run output look different from actual apply?
5. **Scope**: Should T01 cover all resource types (agent, workflow, skill) or just agents?

## Notes

- This is a straightforward implementation, no complex architecture needed
- Main challenge: choosing the right table library and format
- Benefits: Professional output, easier debugging, better UX
- Future: Can add streaming progress for long-running applies

---

## Review Process

**What happens next**:
1. **You review this plan** - Consider the approach, libraries, format
2. **Provide feedback** - Answer questions, suggest changes
3. **I'll revise if needed** - Update plan based on feedback
4. **You approve** - Give explicit approval to proceed
5. **Execution begins** - Implementation tracked in T01_3_execution.md

**Please consider**:
- Is the table format appropriate?
- Library choice: tablewriter vs go-pretty vs custom?
- Should we handle streaming updates now or defer to T02?
- Any other resource types to consider?
