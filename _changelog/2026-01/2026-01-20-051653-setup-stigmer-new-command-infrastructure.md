# Setup `stigmer new` Command Infrastructure

**Date:** 2026-01-20  
**Scope:** CLI, SDK Templates, Demo Repository  
**Type:** Feature Setup  
**Status:** Infrastructure Complete, CLI Implementation Pending

## Summary

Set up complete infrastructure for the `stigmer new` command, which will enable zero-configuration project scaffolding for Stigmer. Created demo repository, updated SDK templates, and documented the implementation approach.

## What Was Built

### 1. Demo Repository: `stigmer/hello-stigmer`

Created a public GitHub repository to serve as the target for generated quickstart examples:

**Repository:** https://github.com/stigmer/hello-stigmer

**Contents:**
- Simple Go calculator implementation (`calculator.go`)
- Comprehensive test coverage (`calculator_test.go`)
- **PR #1:** Open pull request for demo purposes (must remain open)
- Clean, reviewable code perfect for AI analysis

**Key Features:**
- Public repository (no authentication required)
- Real, working code (not fake demo data)
- Permanent demo PR for AI code review examples
- Professional structure and documentation

**Files Created:**
```
hello-stigmer/
├── README.md           # User-facing documentation
├── STIGMER_QUICKSTART.md  # Internal documentation
├── calculator.go       # Calculator implementation
├── calculator_test.go  # Test coverage
├── go.mod             # Go module definition
└── .gitignore         # Standard ignores
```

**PR #1 Details:**
- **Status:** Open (must remain open for demos)
- **Title:** "Add Divide function"  
- **URL:** https://github.com/stigmer/hello-stigmer/pull/1
- **Note:** User reverted the Divide function changes to keep main branch simple

### 2. SDK Template Updates

Updated the SDK's `AgentAndWorkflow()` template for zero-configuration quickstart experience:

**Location:** `stigmer/sdk/go/templates/templates.go`

**Changes:**
- Simplified template to use `hello-stigmer` PR #1 as demo target
- Removed context variable dependencies (zero-config approach)
- Uses public GitHub API (no authentication tokens required)
- Demonstrates agent + workflow integration in ~70 lines

**Template Flow:**
1. Defines AI agent (PR code reviewer)
2. Creates workflow that:
   - Fetches PR #1 from `stigmer/hello-stigmer`
   - Gets PR diff with code changes
   - Calls AI agent to review the code
   - Stores results

**Key Design Decisions:**
- **Zero-config philosophy:** No environment variables, no tokens, no YAML files
- **Public API usage:** Works immediately for everyone
- **Real code analysis:** Analyzes actual PR, not fake data
- **Single file:** Everything in `main.go` for simplicity

**Test Updates:**
- Updated `templates_test.go` to reflect zero-config approach
- Removed `ctx.SetString()` requirement (not needed for demo)
- All tests passing ✅

### 3. Documentation Created

**Implementation Guide:**
- **File:** `STIGMER_NEW_COMMAND_SETUP.md`
- **Purpose:** Complete implementation guide for `stigmer new` command
- **Contents:**
  - Setup summary
  - Template structure
  - Design decisions
  - Implementation checklist
  - Success criteria
  - Example user experience

**Repository Documentation:**
- **File:** `hello-stigmer/STIGMER_QUICKSTART.md`
- **Purpose:** Internal documentation for demo repository
- **Contents:**
  - Repository purpose
  - PR #1 maintenance guidelines
  - SDK template links
  - Design philosophy

## Design Philosophy

### Zero-Configuration First Demo

**The Goal:** User runs `stigmer new my-project && cd my-project && stigmer run` and sees AI magic in <30 seconds.

**How We Achieved It:**

1. **No Environment Files**
   - Old approach: Required `environment.yaml`, `instance.yaml`
   - New approach: Everything in `main.go`, hardcoded to demo repo
   - User doesn't edit configuration files upfront

2. **No Authentication Required**
   - Old approach: Needed GitHub tokens for PR access
   - New approach: Uses public `stigmer/hello-stigmer` repository
   - Works immediately for everyone

3. **Real Code, Real Analysis**
   - Old approach: Abstract examples or fake data
   - New approach: Analyzes actual PR from actual repository
   - Shows production-like use case

4. **Single File Pattern**
   - Agent + Workflow in one `main.go`
   - No directory navigation required
   - Clear, linear flow

### Progressive Disclosure

**First Experience (what we built):**
- Just `main.go` with agent + workflow
- No configuration files
- Works immediately
- Shows core value

**Documentation (for later learning):**
- How to add environment configuration
- How to use private repositories
- How to create instances
- How to deploy to production

**Philosophy:** Introduce complexity when users NEED it, not upfront.

## Implementation Status

### ✅ Completed

- [x] Created `stigmer/hello-stigmer` repository
- [x] Added calculator code with comprehensive tests
- [x] Created PR #1 with reviewable code changes
- [x] Updated SDK template (`AgentAndWorkflow()`)
- [x] Updated SDK template tests (all passing)
- [x] Committed SDK template changes
- [x] Created implementation documentation
- [x] Created demo repository documentation

### 🚧 To Be Implemented

- [ ] Implement `stigmer new` command in CLI
  - Location: `client-apps/cli/cmd/stigmer/root/new.go`
  - Should use `templates.AgentAndWorkflow()` from SDK
  - Generate project structure (stigmer.yaml, main.go, go.mod, .gitignore, README.md)
  - Run `go mod tidy` to install dependencies
  - Show success message with next steps

- [ ] Create README.md template for generated projects
  - Quick start (3 steps max)
  - What's included
  - How to customize
  - Link to advanced docs

- [ ] Test end-to-end flow
  - Run `stigmer new my-project`
  - Verify all files generated correctly
  - Run `stigmer run` and verify workflow executes
  - Verify AI produces code review output

- [ ] Update CLI documentation
  - Add `stigmer new` to COMMANDS.md
  - Update main README with quickstart example
  - Add to docs site if applicable

## Technical Details

### SDK Template Structure

The generated `main.go` will contain:

```go
package main

import (
    "log"
    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/stigmer"
    "github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
    err := stigmer.Run(func(ctx *stigmer.Context) error {
        // Define AI agent
        reviewer, err := agent.New(ctx, /* ... */)
        
        // Create workflow
        pipeline, err := workflow.New(ctx, /* ... */)
        
        // Fetch PR from hello-stigmer
        fetchPR := pipeline.HttpGet("fetch-pr",
            "https://api.github.com/repos/stigmer/hello-stigmer/pulls/1",
            /* headers */
        )
        
        // Get PR diff
        fetchDiff := pipeline.HttpGet("fetch-diff", 
            fetchPR.Field("diff_url").Expression(),
            /* headers */
        )
        
        // Call agent to analyze
        analyze := pipeline.CallAgent("analyze-pr", /* ... */)
        
        // Store results
        results := pipeline.SetVars("store-results", /* ... */)
        
        return nil
    })
    
    if err != nil {
        log.Fatal(err)
    }
}
```

### Project Structure to Generate

```
my-stigmer-project/
├── stigmer.yaml      # Project metadata (4 lines)
├── main.go          # Agent + Workflow (~70 lines)
├── go.mod           # Go dependencies
├── .gitignore       # Standard ignores
└── README.md        # Quick start guide
```

### Demo Repository Maintenance

**Critical:** PR #1 in `stigmer/hello-stigmer` must remain **open permanently**.

- ❌ Do not merge PR #1
- ❌ Do not close PR #1  
- ✅ Keep it open for quickstart demos
- ✅ If changes needed, create new PRs and update SDK template

## Why This Matters

### For Users

**Before (complex onboarding):**
```bash
# Download example
# Edit environment.yaml (set GitHub token)
# Edit instance.yaml (configure agent)
# Run stigmer apply
# Run stigmer run
# Debug auth issues
# Total time: 10+ minutes, multiple config files
```

**After (zero-config magic):**
```bash
stigmer new my-project
cd my-project
stigmer run
# Total time: <30 seconds, no configuration
```

### For Stigmer Adoption

1. **Immediate Value:** Users see AI in action within seconds
2. **Lower Barrier:** No tokens, no setup, no prerequisites
3. **Real Example:** Actual code review, not toy demo
4. **Clear Path Forward:** Easy to customize for their needs

### For Development

1. **Reusable Pattern:** Template system enables multiple examples
2. **SDK-Driven:** Templates live in SDK (single source of truth)
3. **Testable:** Templates compile and validate automatically
4. **Maintainable:** Updates propagate through imports

## Next Steps

The foundation is complete. Next conversation should:

1. Implement `stigmer new` command in CLI
2. Create README template for generated projects
3. Test end-to-end: `stigmer new` → `stigmer run` → success
4. Update CLI documentation

See `STIGMER_NEW_COMMAND_SETUP.md` for complete implementation guide.

## Files Changed

### SDK Repository
- `sdk/go/templates/templates.go` - Updated `AgentAndWorkflow()` template
- `sdk/go/templates/templates_test.go` - Updated test requirements
- `sdk/go/templates/README.md` - Updated template documentation

### Demo Repository (`stigmer/hello-stigmer`)
- `README.md` - User-facing documentation
- `STIGMER_QUICKSTART.md` - Internal documentation
- `calculator.go` - Calculator implementation
- `calculator_test.go` - Test coverage
- `go.mod` - Go module
- `.gitignore` - Standard ignores

### Main Repository
- `STIGMER_NEW_COMMAND_SETUP.md` - Implementation guide

## Related Links

- **Demo Repository:** https://github.com/stigmer/hello-stigmer
- **PR #1:** https://github.com/stigmer/hello-stigmer/pull/1
- **SDK Template:** `stigmer/sdk/go/templates/templates.go::AgentAndWorkflow()`
- **Implementation Guide:** `STIGMER_NEW_COMMAND_SETUP.md`

## Success Metrics

Once implemented, success looks like:

✅ User runs `stigmer new my-first-agent`  
✅ Project created with all files in <5 seconds  
✅ Dependencies installed automatically  
✅ User runs `stigmer run`  
✅ Workflow fetches PR from `stigmer/hello-stigmer`  
✅ AI agent analyzes the code  
✅ Review displayed to user  
✅ **Total time from `stigmer new` to AI output: <30 seconds**  
✅ **Zero configuration required**

---

**Infrastructure Ready:** ✅  
**Next:** Implement CLI command and test end-to-end flow
