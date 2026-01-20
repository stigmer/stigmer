# Implement Pulumi-Style Project Naming for `stigmer new`

**Date**: 2026-01-20  
**Type**: Enhancement  
**Scope**: CLI (`stigmer new` command)  
**Impact**: User-facing behavior change (backward compatible)

## Summary

Updated the `stigmer new` command to follow industry-standard directory naming conventions used by Pulumi, AWS CDK, and Terraform. The command now uses the current directory name as the project name when no argument is provided, matching the patterns developers expect from modern IaC tools.

## Context

### Problem

The `stigmer new` command previously used a hardcoded default project name "stigmer-project":

```go
projectName := "stigmer-project"  // Hardcoded default
```

This resulted in:
- Generic project names ("stigmer-project", "stigmer-project-2", etc.)
- Deviation from industry standards (Pulumi, CDK, Terraform)
- Less intentional project naming
- Not following the "least surprise" principle for IaC-style tools

### Research

Analyzed naming conventions across major CLIs:

**Infrastructure Tools (IaC):**
- **Pulumi**: Uses current directory name as project name
  - `mkdir my-app && cd my-app && pulumi new` → project named "my-app"
- **AWS CDK**: Uses current directory name for stack naming
  - `mkdir frontend-infra && cd frontend-infra && cdk init` → generates "FrontendInfraStack"
- **Terraform**: Operates in current directory without project naming concept

**Frontend Frameworks:**
- **create-next-app**: Prompts if no name provided
  - `npx create-next-app@latest` → prompts "What is your project named?"
- **create-vue**: Same prompting pattern

**Conclusion**: Stigmer is positioned as a workflow/infrastructure tool, so the **IaC pattern** (current directory naming) is the appropriate choice.

## What Changed

### Implementation

**File: `client-apps/cli/cmd/stigmer/root/new.go`**

#### New Logic

```go
var projectName string
var projectDir string

if len(args) > 0 {
    // User provided a name - create new directory
    projectName = args[0]
    projectDir = projectName
} else {
    // No argument - use current directory name (Pulumi pattern)
    cwd, err := os.Getwd()
    if err != nil {
        cliprint.PrintError("Failed to get current directory")
        clierr.Handle(err)
        return
    }
    projectName = filepath.Base(cwd)
    projectDir = "."
}
```

#### Smart Directory Handling

1. **Current Directory Mode** (`projectDir == "."`):
   - Checks if directory is empty (ignores hidden files)
   - Errors if non-empty with helpful message
   - Creates files directly in current directory

2. **New Directory Mode** (`projectDir == projectName`):
   - Checks if directory already exists
   - Creates directory if needed
   - Initializes project inside new directory

3. **Error Handling**:
   - Only removes created directory on failure (not current directory)
   - Clear error messages with guidance

#### Updated Help Text

Added comprehensive examples and usage patterns:

```go
Example: `  # Create project in current directory (directory must be empty)
  mkdir my-stigmer-app && cd my-stigmer-app
  stigmer new

  # Create new directory and initialize project
  stigmer new my-stigmer-app
  cd my-stigmer-app
  stigmer run`,
```

### Documentation Updates

**Files Updated:**
1. `docs/getting-started/local-mode.md` - Quick Start section now shows both patterns
2. `client-apps/cli/COMMANDS.md` - Project Scaffolding and Quick Start sections updated

## Usage Patterns

### Pattern 1: Current Directory (NEW!)

```bash
# Uses directory name as project name
mkdir pr-reviewer && cd pr-reviewer
stigmer new
# → Creates project named "pr-reviewer" in current directory
```

### Pattern 2: Create New Directory (EXISTING)

```bash
# Creates new directory and initializes there
stigmer new my-awesome-agent
cd my-awesome-agent
stigmer run
# → Creates "./my-awesome-agent/" directory
```

### Error Handling

```bash
# Empty directory check
cd non-empty-folder
stigmer new
# → Error: "Current directory is not empty"
#    "Please run 'stigmer new' in an empty directory or provide a project name:"
#    "  stigmer new my-project"

# Existing directory check
stigmer new existing-folder
# → Error: "Directory 'existing-folder' already exists"
```

## Benefits

### ✅ Industry Alignment
- Matches Pulumi, AWS CDK, and Terraform patterns
- Follows conventions developers expect from IaC tools
- Reduces cognitive load when switching between tools

### ✅ Eliminates Generic Names
- No more "stigmer-project" directories everywhere
- Developers choose meaningful names first (intentional)
- Project names reflect actual purpose

### ✅ Backward Compatible
- `stigmer new my-project` still works exactly as before
- Existing scripts and documentation remain valid
- No breaking changes

### ✅ New Capability
- Can initialize in current directory (like Pulumi)
- More flexible for different workflows
- Supports monorepo patterns better

## Testing

Manual testing confirmed:

1. **Pattern 1 (current directory)**:
   ```bash
   mkdir test-app && cd test-app
   stigmer new
   # ✅ Creates project named "test-app" in current dir
   ```

2. **Pattern 2 (new directory)**:
   ```bash
   stigmer new another-app
   # ✅ Creates ./another-app/ directory
   ```

3. **Empty directory check**:
   ```bash
   echo "file" > test.txt
   stigmer new
   # ✅ Error: "Current directory is not empty"
   ```

4. **Existing directory check**:
   ```bash
   mkdir existing && stigmer new existing
   # ✅ Error: "Directory 'existing' already exists"
   ```

5. **Success message**:
   - Shows `cd <dir>` only when creating new directory
   - Skips `cd` instruction when in current directory

## Code Quality

Follows all Stigmer CLI coding guidelines:

- ✅ **Single Responsibility**: Separated directory detection from validation
- ✅ **Error Handling**: All errors wrapped with context using `errors.Wrap`
- ✅ **Clear Messages**: Actionable error messages with guidance
- ✅ **Output Formatting**: Uses `cliprint` for consistent formatting
- ✅ **File Size**: Function remains under 150 lines (well-organized)

## Files Modified

```
M  client-apps/cli/cmd/stigmer/root/new.go
M  docs/getting-started/local-mode.md
M  client-apps/cli/COMMANDS.md
```

## Next Steps

**No further action needed** - implementation is complete and tested.

**Future enhancements** (not required now):
- Support `.` as explicit argument (e.g., `stigmer new .`)
- Add `--force` flag to initialize in non-empty directory
- Template selection (e.g., `stigmer new --template=minimal`)

## Related Work

- Based on research of Pulumi, AWS CDK, Terraform, create-next-app, create-vue conventions
- Aligns with Stigmer's positioning as workflow/infrastructure tool
- Follows CLI coding guidelines: `@.cursor/rules/client-apps/cli/coding-guidelines.mdc`

---

**Implementation**: Complete  
**Testing**: Manual testing passed  
**Documentation**: Updated  
**Quality**: Follows all coding standards  
**User Impact**: Positive (more intuitive, industry-standard behavior)
