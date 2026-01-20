# Bracket Notation for Task References

## Overview

The Stigmer Go SDK uses **bracket notation** for task references in generated expressions to support task names with special characters, particularly hyphens.

## The Problem

Previously, task field references used dot notation:

```go
fetchPR := pipeline.HttpGet("fetch-pr", ...)
diff := fetchPR.Field("diff_url").Expression()
// Generated: ${ $context.fetch-pr.diff_url }
```

This caused jq parsing errors because `fetch-pr` was interpreted as:
- `fetch` (variable)
- `-` (minus operator)
- `pr` (function call)

Error: `function not defined: pr/0`

## The Solution

Now we use **bracket notation** for the task name:

```go
fetchPR := pipeline.HttpGet("fetch-pr", ...)
diff := fetchPR.Field("diff_url").Expression()
// Generated: ${ $context["fetch-pr"].diff_url }
```

This is standard JSON/jq syntax and supports any valid string as a task name.

## Why This Approach?

### Compared to Alternatives

**❌ Enforce underscore-only naming**
```go
// Forces users to remember arbitrary restrictions
fetchPR := pipeline.HttpGet("fetch_pr", ...)  // Must use underscores
```
- Bad UX - artificial restriction
- Goes against Kubernetes/cloud native conventions (kebab-case is common)

**❌ Auto-sanitize internally**
```go
// User writes "fetch-pr", internally stored as "fetch_pr"
fetchPR := pipeline.HttpGet("fetch-pr", ...)
// Confusing: name differs from what user sees
```
- Surprising behavior
- Two names for same thing (display vs internal)

**✅ Use bracket notation (chosen)**
```go
// User can use any valid name
fetchPR := pipeline.HttpGet("fetch-pr", ...)
diff := fetchPR.Field("diff_url").Expression()
// ${ $context["fetch-pr"].diff_url } - just works!
```
- **No restrictions on naming**
- Standard JSON/jq syntax
- Follows Principle of Least Astonishment

### Inspired by Pulumi

Pulumi separates resource names from programmatic references:

```typescript
const myBucket = new aws.s3.Bucket("my-prod-bucket", { ... });
const url = myBucket.websiteEndpoint;  // Reference via variable
```

Similarly, Stigmer uses:
```go
fetchPR := pipeline.HttpGet("fetch-pr", ...)  // String name (display)
url := fetchPR.Field("diff_url")              // Reference via Go variable
```

The bracket notation in generated expressions is an implementation detail that enables this flexibility.

## Supported Task Names

With bracket notation, all these work:

```go
pipeline.HttpGet("fetch-pr", ...)           // ✅ Hyphens
pipeline.HttpGet("fetch_data", ...)         // ✅ Underscores
pipeline.HttpGet("fetchData", ...)          // ✅ camelCase
pipeline.HttpGet("fetch-pr-data", ...)      // ✅ Multiple hyphens
pipeline.HttpGet("fetch-pr_data", ...)      // ✅ Mixed
```

## Generated Expression Format

```go
task.Field("fieldName").Expression()
```

Generates:
```
${ $context["taskName"].fieldName }
```

Where:
- `$context["taskName"]` uses **bracket notation** (supports special characters)
- `.fieldName` uses **dot notation** (field names are typically simple identifiers)

## Examples

### Basic Usage

```go
fetchPR := pipeline.HttpGet("fetch-pr",
    "https://api.github.com/repos/owner/repo/pulls/1",
)

fetchDiff := pipeline.HttpGet("fetch-diff",
    fetchPR.Field("diff_url").Expression(),  // ${ $context["fetch-pr"].diff_url }
)
```

### Multiple Fields

```go
analyze := pipeline.CallAgent("analyze-pr",
    workflow.Message(
        "PR Title: " + fetchPR.Field("title").Expression() +      // ${ $context["fetch-pr"].title }
        "\nPR Body: " + fetchPR.Field("body").Expression() +      // ${ $context["fetch-pr"].body }
        "\nCode Changes:\n" + fetchDiff.Field("body").Expression(), // ${ $context["fetch-diff"].body }
    ),
)
```

### Store Results

```go
results := pipeline.SetVars("store-results",
    "prTitle", fetchPR.Field("title"),        // ${ $context["fetch-pr"].title }
    "prNumber", fetchPR.Field("number"),      // ${ $context["fetch-pr"].number }
    "review", analyze.Field("response"),      // ${ $context["analyze-pr"].response }
)
```

## Implementation Details

### Code Change

In `sdk/go/workflow/task.go`:

```go
// Expression returns the JQ expression for this field reference.
func (r TaskFieldRef) Expression() string {
    // Use bracket notation for task name to support hyphens and special characters
    // Reference format: ${ $context["task-name"].fieldName }
    return fmt.Sprintf("${ $context[\"%s\"].%s }", r.taskName, r.fieldName)
}
```

### Test Coverage

Tests verify bracket notation with various naming patterns:
- Hyphens: `fetch-pr`
- Multiple hyphens: `fetch-github-pr-diff`
- Mixed: `fetch-pr_data`
- Underscores: `fetch_data`

See `task_bracket_test.go` for full test suite.

## Migration

No migration needed! This is a **non-breaking change**:

- Existing code continues to work
- Task names with underscores still work
- Generated expressions are semantically equivalent (just different syntax)

Users can now freely use hyphens in task names without jq parsing errors.

## Best Practices

### Naming Recommendations

While any valid string works, we recommend:

```go
// ✅ Recommended: kebab-case (cloud-native convention)
pipeline.HttpGet("fetch-pr", ...)
pipeline.HttpGet("analyze-code", ...)
pipeline.HttpGet("store-results", ...)

// ✅ Also fine: snake_case
pipeline.HttpGet("fetch_pr", ...)
pipeline.HttpGet("analyze_code", ...)

// ✅ Also fine: camelCase
pipeline.HttpGet("fetchPR", ...)
pipeline.HttpGet("analyzeCode", ...)
```

Choose one style and be consistent within your project.

### What to Avoid

```go
// ❌ Spaces (requires quoting everywhere)
pipeline.HttpGet("fetch PR", ...)

// ❌ Special characters (hard to read)
pipeline.HttpGet("fetch@pr#123", ...)

// ❌ Starting with numbers (some systems reject this)
pipeline.HttpGet("1-fetch-pr", ...)
```

## Related Documentation

- [Task Field References](./task.go#L64-L107)
- [Expression Helpers](./task.go#L1351-L1450)
- [Workflow Examples](../examples/)

## Questions?

If you encounter issues with task naming:

1. Check that your task names don't contain spaces
2. Verify the generated YAML uses bracket notation: `$context["task-name"]`
3. Test with `stigmer run` to see if workflow executes correctly

For bugs or feature requests, open an issue on GitHub.
