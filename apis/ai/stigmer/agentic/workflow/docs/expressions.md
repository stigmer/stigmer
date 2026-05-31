# Workflow Expression Syntax

Expressions are the dynamic layer of workflows. Any field marked as supporting expressions can embed a JQ-based `${ ... }` expression to compute values from workflow context, environment variables, secrets, or previous task output.

## Syntax Overview

Expressions are delimited by `${` and `}`:

```yaml
uri: "https://api.example.com/users/${$context.userId}"
message: "Found ${$context.results | length} items"
status: "${$context.checkResult.status}"
```

String fields can mix literal text with expressions. Struct fields (request bodies, task inputs) use expressions only in string values — numeric and boolean values are literal.

```yaml
body:
  userId: "${$context.user.id}"    # expression in string value
  retryCount: 3                    # literal integer — no expression
  enabled: true                    # literal boolean — no expression
```

## Context Variables

These special variables are available in all expression contexts:

| Variable | Description |
|---|---|
| `$context` | Accumulated workflow context: all exported task outputs, `set_vars` assignments, and loop variables. |
| `$context.<taskName>` | Output of a specific task (if that task had `export.as` set). |
| `.env.<NAME>` | Environment variable declared in `spec.env_spec`. |
| `.secrets.<NAME>` | Secret value from the workflow instance's secret bindings. |
| `now` | Current timestamp in ISO 8601 format. |
| `$data.item` | Current item in a `for_each` loop (name matches the `each` field). |
| `$data.index` | 0-based index of the current item in a `for_each` loop. |

## Accessing Task Output

Task outputs are accessed via `$context.<taskName>` after that task has exported its result.

```yaml
# Task: fetchUser with export.as: "${.body}"
- name: fetchUser
  kind: http_call
  task_config:
    method: GET
    endpoint:
      uri: "https://api.example.com/users/123"
  export:
    as: "${.body}"

# Later task: access the exported output
- name: sendEmail
  kind: activity_call
  task_config:
    activity: "SendEmailActivity"
    input:
      to: "${$context.fetchUser.email}"
      name: "${$context.fetchUser.firstName} ${$context.fetchUser.lastName}"
```

If `export` is omitted on a task, its output is not stored and cannot be accessed by downstream tasks.

## JQ Expressions

Expressions use a JQ-compatible syntax. The input to the expression (`.`) is the task's current output or context, depending on where the expression appears.

### Field Access

```yaml
# Dot notation
"${.fieldName}"
"${.nested.field}"
"${.array[0]}"
"${.array[0].name}"

# Access entire context
"${$context}"

# Access specific task output field
"${$context.myTask.body.id}"
```

### String Interpolation

Multiple expressions can appear in a single string:

```yaml
message: "Hello ${$context.user.name}, your order ${$context.order.id} is ready"
uri: "https://api.example.com/${.env.API_VERSION}/users/${$context.userId}"
```

### Arithmetic and Comparison

```yaml
# Arithmetic
"${$context.price * 1.1}"
"${$context.items | length}"

# String comparison — single quotes recommended in YAML
"${ $context.status == 'active' }"
"${ $context.severity == 'critical' }"

# String concatenation
"${$context.firstName + ' ' + $context.lastName}"

# Numeric and boolean comparison
"${$context.score > 80}"
"${$context.count >= 1 and $context.enabled == true}"
```

> **YAML quoting tip**: Use single quotes (`'...'`) for string literals inside
> expressions. The expression engine automatically converts them to double
> quotes for jq. This is more ergonomic than escaping double quotes inside
> YAML double-quoted values (`\"...\"`). Both forms work — use whichever
> reads better in your context.

### Array and Object Operations

```yaml
# Array length
"${$context.results | length}"

# Array access
"${$context.items[0].id}"

# Filter array (keep items where active == true)
"${$context.users | map(select(.active == true))}"

# Map over array (extract field)
"${$context.orders | map(.id)}"

# Check if field exists and is non-empty
"${$context.token != null and $context.token != ''}"
```

### Merge Objects into Context

The `export.as` field can merge task output into existing context:

```yaml
export:
  as: "${$context + {fetchResult: .}}"
```

This adds the task output under the key `fetchResult` while preserving all existing context entries.

## Environment Variables

Environment variables are declared in `spec.env_spec` and accessed via `.env.<NAME>`:

```yaml
spec:
  env_spec:
    variables:
      - name: API_BASE_URL
        required: true
      - name: TIMEOUT
        required: false
        default: "30"

# In task configs:
endpoint:
  uri: "${.env.API_BASE_URL}/users"
timeout_seconds: "${.env.TIMEOUT | tonumber}"
```

Variables marked `required: true` that are not bound in the Workflow Instance cause execution to fail at startup with a clear error.

## Secrets

Secrets are referenced via `.secrets.<NAME>` and sourced from the Workflow Instance's secret bindings. Secret values are never logged.

```yaml
headers:
  Authorization: "Bearer ${.secrets.API_KEY}"
env:
  GITHUB_TOKEN: "${.secrets.GH_PAT}"
```

## Loop Variables

Inside `for_each` task `do` blocks, two additional variables are available:

```yaml
- name: processItems
  kind: for_each
  task_config:
    each: item
    in: "${$context.fetchData.body.items}"
    do:
      - name: processOne
        kind: http_call
        task_config:
          method: POST
          endpoint:
            uri: "https://api.example.com/process"
          body:
            item: "${$data.item}"       # current item (named by "each")
            position: "${$data.index}"  # 0-based index
            total: "${$context.fetchData.body.items | length}"
```

## Timestamp Expressions

```yaml
# Current timestamp
startedAt: "${now}"

# The "until" field in wait tasks uses literal RFC 3339 strings, not expressions
- name: waitUntilMorning
  kind: wait
  task_config:
    until: "2026-03-01T09:00:00Z"
```

## Common Patterns

### Null safety check

```yaml
# In switch_case when:
when: "${$context.user != null and $context.user.email != null}"
```

### Default value

```yaml
"${$context.config.timeout // '30'}"   # use "30" if null
```

### Conditional string

```yaml
"${if $context.isProd then 'production' else 'staging' end}"
```

### Extract nested list

```yaml
in: "${$context.apiResponse.body.data.items}"
```

### Numeric conversion

```yaml
timeout_seconds: "${.env.TIMEOUT | tonumber}"
```

## Validation

Expressions are validated at two points:

1. **Workflow validation** (async, after `stigmer apply`) — The platform checks expression syntax during DSL generation. Syntax errors appear in `status.serverless_workflow_validation.errors`.

2. **Execution time** — Expressions are evaluated when the task runs. A reference to `$context.taskName` where `taskName` never exported will evaluate to `null`. This is not an error unless downstream code treats null as invalid.

Common expression errors in `status.serverless_workflow_validation.errors`:

| Error | Cause |
|---|---|
| `Invalid expression syntax at task 'myTask'` | Malformed `${ }` expression |
| `Undefined context reference '$context.unknownTask'` | Task name doesn't exist or didn't export |
| `Environment variable 'FOO' referenced but not declared` | Missing `env_spec` declaration |

## Related Documentation

- [task-reference.md](task-reference.md) — Which fields on each task support expressions
- [workflow-resource-guide.md](workflow-resource-guide.md) — `export.as`, `flow.then`, and `env_spec` fields
- [examples.md](examples.md) — Complete workflows with real expression usage
