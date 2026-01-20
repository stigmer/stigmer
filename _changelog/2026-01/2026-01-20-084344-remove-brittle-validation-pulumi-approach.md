# Remove Brittle Import Validation, Adopt Pulumi-Inspired Validation Philosophy

**Date**: 2026-01-20  
**Type**: Refactor  
**Scope**: CLI / Validation  
**Impact**: High (Architecture change, improves maintainability and user experience)

## Summary

Removed brittle string-based import validation from `stigmer apply` command and adopted Pulumi's philosophy of trusting language tooling and validating outcomes instead of syntax. This eliminates a common failure point (validation breaking when import paths change) and provides better error messages from Go's compiler.

## Problem

The CLI was performing string-based validation of Go import statements before executing user code:

```go
// OLD: Brittle string matching
hasAgentImport := strings.Contains(contentStr, "github.com/stigmer/stigmer-sdk/go/agent")
if !hasAgentImport && !hasWorkflowImport && !hasStigmerImport {
    return errors.New("file must import Stigmer SDK")
}
```

**Issues with this approach:**
1. **Breaks on path changes**: Validation was checking for `stigmer-sdk` (separate repo pattern from Stigmer Cloud), but OSS uses monorepo path `stigmer/stigmer/sdk/go/...`
2. **Duplicates compiler's job**: Go already validates imports perfectly
3. **Poor error messages**: Generic "must import SDK" instead of specific Go compiler errors
4. **Maintenance burden**: Needs updating whenever import structure changes
5. **False sense of security**: Checking imports doesn't validate if code actually works

**Real-world failure:**
```
Error: file must import Stigmer SDK (agent, workflow, or stigmer package)
```

But the file DID import the SDK - just from the correct monorepo path that validation didn't recognize.

## Solution: Pulumi-Inspired Validation

Adopted Pulumi's approach: **Trust the language tooling, validate outcomes.**

### What Pulumi Does Right

Pulumi doesn't pre-validate imports or syntax. Instead:
1. Run user's code with the language's native tooling (`go run`, `python`, etc.)
2. Let compiler/interpreter catch syntax/import errors (better error messages)
3. Check if resources were registered (validate the outcome)
4. Fail with helpful context if no resources found

### Changes Made

**1. Removed `ValidateGoFile()` pre-execution validation**

```go
// ❌ REMOVED: Pre-validation of imports
err = agent.ValidateGoFile(mainFilePath)
if err != nil {
    return nil, nil, err
}

// ✅ NEW: Go directly to execution
manifestResult, err := agent.ExecuteGoAgentAndGetManifest(mainFilePath)
```

**2. Updated validation philosophy in code comments**

Added comprehensive documentation explaining the Pulumi-inspired approach:

```go
// Validation Philosophy (Pulumi-Inspired)
//
// Unlike traditional tools that pre-validate everything, Stigmer follows Pulumi's approach:
// 1. Trust the language tooling (Go compiler validates imports, syntax, etc.)
// 2. Execute the program and let natural failures occur
// 3. Validate outcomes (did resources get registered?)
//
// Benefits:
// - Simpler code
// - Better error messages from Go compiler
// - More flexible (works with any import path structure)
// - Less maintenance burden
```

**3. Improved post-execution validation**

Enhanced error message when no resources are created:

```go
if result.AgentManifest == nil && result.WorkflowManifest == nil {
    return nil, errors.New("no resources were created - your code must use Stigmer SDK\n\n" +
        "Example:\n" +
        "  import \"github.com/stigmer/stigmer/sdk/go/stigmer\"\n" +
        "  import \"github.com/stigmer/stigmer/sdk/go/agent\"\n\n" +
        "  func main() {\n" +
        "      stigmer.Run(func(ctx *stigmer.Context) error {\n" +
        "          agent.New(ctx, agent.WithName(\"my-agent\"), ...)\n" +
        "          return nil\n" +
        "      })\n" +
        "  }")
}
```

**4. Fixed nil pointer crash in workflow display**

While fixing validation, discovered and fixed nil pointer dereference when displaying workflows:

```go
// OLD: Assumed wf.Metadata exists (caused panic)
cliprint.PrintInfo("  %d. %s", i+1, wf.Metadata.Name)

// NEW: Proper nil checks with correct proto field path
if wf != nil && wf.Spec != nil && wf.Spec.Document != nil && wf.Spec.Document.Name != "" {
    name = wf.Spec.Document.Name
}
```

## Files Changed

### Modified
- `client-apps/cli/cmd/stigmer/root/apply.go` - Removed pre-validation step
- `client-apps/cli/internal/cli/agent/validation.go` - Updated philosophy, removed `ValidateGoFile()`
- `client-apps/cli/internal/cli/agent/execute.go` - Updated comments, improved error messages

## Execution Flow Comparison

### Before (Multiple Validation Layers)

```
1. Check if file exists
2. Check if file is .go
3. ❌ Check if file contains correct import strings
   └─ Fails if import path doesn't match hardcoded pattern
4. Validate go.mod
5. Run go mod tidy
6. Execute user code
7. Check if manifests were generated
```

### After (Trust Compiler, Validate Outcomes)

```
1. Check if file exists
2. Check if file is .go
3. Validate go.mod (minimal - checks readability)
4. Run go mod tidy
5. Execute user code
   └─ Go compiler validates imports (better error messages)
6. Check if manifests were generated
   └─ Helpful error with example if none found
```

## Benefits

### 1. More Robust
- **Doesn't break on import path changes**: No hardcoded import paths to maintain
- **Works with any module structure**: Monorepo, separate repo, local replace directives - all work

### 2. Better Error Messages

**Before** (generic):
```
Error: file must import Stigmer SDK (agent, workflow, or stigmer package)
```

**After** (specific from Go):
```
# If missing import:
main.go:10:2: undefined: agent

# If wrong import path:
main.go:4:2: cannot find package "github.com/wrong/path" in any of...

# If no resources created:
Error: no resources were created - your code must use Stigmer SDK to define agents or workflows

Example:
  import "github.com/stigmer/stigmer/sdk/go/stigmer"
  import "github.com/stigmer/stigmer/sdk/go/agent"
  ...
```

### 3. Simpler Code
- Removed 30+ lines of validation code
- Less maintenance burden
- Fewer edge cases to handle

### 4. Pulumi-like Developer Experience
- Trust the language's native tooling
- Let developers see familiar compiler errors
- Validate what matters (resources created) not syntax (imports)

## Testing

Verified with test project:

```bash
cd ~/.stigmer/stigmer-project
stigmer apply
```

**Output:**
```
ℹ Loading project configuration...
✓ Loaded Stigmer.yaml

ℹ Executing entry point to discover resources...
✓ Manifest loaded: 2 resource(s) discovered (1 agent(s), 1 workflow(s))

ℹ Agents discovered: 1
ℹ   1. pr-reviewer
ℹ      Description: AI code reviewer that analyzes pull requests

ℹ Workflows discovered: 1
ℹ   1. review-demo-pr
ℹ      Description: Analyzes a demo pull request with AI
```

✅ Successfully discovered and validated resources without pre-validation of imports.

## Design Decisions

### Why Remove Pre-Validation?

**Question:** Shouldn't we validate as much as possible upfront?

**Answer:** No. Here's why:

1. **Go compiler is better at this**: It knows all import resolution rules, module paths, replace directives, etc.
2. **Pre-validation can give false positives/negatives**: String matching can't handle all valid Go code patterns
3. **Maintenance cost**: Every change to import structure requires updating validation
4. **Worse UX**: Generic error vs. specific compiler error

### Why Follow Pulumi's Approach?

Pulumi is one of the most successful IaC tools precisely because it **trusts the programming language**:

- Python users see Python errors
- Go users see Go errors
- TypeScript users see TypeScript errors

They validate **outcomes** (resources declared) not **syntax** (how you declared them).

This is the right model for Stigmer:
- Trust Go's tooling for Go validation
- Validate that agents/workflows were created
- Focus on deployment correctness, not code style

### What About Missing SDK Imports?

If user's code doesn't import the SDK:

**Before:**
```
Error: file must import Stigmer SDK
```

**After:**
```
# Go compiler gives specific error:
main.go:15:2: undefined: stigmer
main.go:16:2: undefined: agent

# If code compiles but doesn't register resources:
Error: no resources were created - your code must use Stigmer SDK to define agents or workflows

Example:
  import "github.com/stigmer/stigmer/sdk/go/stigmer"
  ...
```

The "After" approach provides **more actionable information** - user knows exactly what's undefined and where.

## Migration Notes

### For Users
No breaking changes. Code that worked before continues to work. Code that failed with generic error now gets better error messages.

### For Developers
If adding new SDK packages in the future, **no validation code to update**. The approach is import-path-agnostic.

## Related Work

This change aligns with:
- **Pulumi's validation philosophy**: Trust language tooling, validate outcomes
- **Go's design philosophy**: Let the toolchain do its job
- **Stigmer's SDK architecture**: Language-idiomatic, not prescriptive

## Future Considerations

### Could Apply This Pattern To:
1. **Python SDK validation** - Currently might have similar string-based checks
2. **TypeScript SDK validation** - Same principle applies
3. **YAML validation** - Validate structure/schema, not specific field names

### Not Applicable To:
- **Proto validation** - Must validate proto definitions (no external compiler)
- **Manifest validation** - Must validate SDK-CLI contract (custom format)
- **Backend validation** - Must validate business logic (not language syntax)

## Lessons Learned

### 1. Import Path Brittleness
String-based validation of import paths is fragile. It broke when moving from:
- Stigmer Cloud: `github.com/leftbin/stigmer-sdk/go/agent`
- Stigmer OSS: `github.com/stigmer/stigmer/sdk/go/agent`

This would have been caught in code review, but the real fix is: **don't validate import paths**.

### 2. Trust Your Compiler
Modern compilers/interpreters are extremely good at their job. Don't duplicate their work.

### 3. Validate Outcomes, Not Syntax
The only thing that matters: Did the user declare resources they want to deploy?
Everything else (imports, syntax, formatting) is the language tooling's responsibility.

### 4. Better Error Messages Come From Native Tooling
Go's compiler knows exactly what's wrong and where. Our generic "must import SDK" error was less helpful.

## Impact Assessment

### Positive Impacts
- ✅ More maintainable (less validation code)
- ✅ More robust (doesn't break on path changes)
- ✅ Better UX (specific compiler errors)
- ✅ Faster execution (one less validation step)
- ✅ Aligns with industry best practices (Pulumi model)

### Potential Risks (Mitigated)
- ⚠️ **Risk:** Users might get compiler errors instead of friendly messages
  - **Mitigation:** Compiler errors ARE friendly - they're specific and actionable
- ⚠️ **Risk:** No early validation of SDK usage
  - **Mitigation:** Post-execution validation ensures resources were created
  - **Mitigation:** Improved error message shows SDK usage example

### Breaking Changes
None. This is a pure refactor of validation logic.

## References

- **Pulumi**: https://www.pulumi.com/docs/intro/concepts/how-pulumi-works/
  - Section: "Programming Model" - explains trust-the-language approach
- **Go Modules**: https://go.dev/ref/mod
  - Import resolution rules that validation was trying to duplicate
- **Stigmer SDK Documentation**: `docs/sdk/go-sdk.md`
  - Shows correct import paths users should use

## Conclusion

By removing brittle string-based import validation and adopting Pulumi's philosophy of trusting language tooling, we've made Stigmer CLI more maintainable, robust, and user-friendly. The Go compiler provides better error messages than our custom validation ever could, and validating outcomes (resources created) is what actually matters.

This change exemplifies good engineering: **do less, but do it better**. Let each tool (Go compiler, Stigmer SDK, Stigmer CLI) focus on what it does best.

---

**Author**: Cursor AI (with Suresh)  
**Reviewer**: Suresh Natarajan  
**Status**: ✅ Implemented and tested
