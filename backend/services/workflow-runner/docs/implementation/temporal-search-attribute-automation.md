# Temporal Search Attribute Automation

**Date**: 2026-01-16  
**Status**: ✅ Complete  
**Impact**: Eliminates manual setup step - search attributes automatically created like database migrations

## Problem

Temporal search attributes must exist before workflows can use them. Previously:
- ❌ Required manual CLI commands after Temporal deployment
- ❌ Easy to forget during environment setup
- ❌ Caused silent failures (progress reporting didn't work)
- ❌ Needed documentation hunting when things broke

**Like**: Database columns missing - app runs but features fail mysteriously.

## Solution

Automated search attribute provisioning with three approaches:

### 1. Automatic Setup (Like DB Migrations)

Worker automatically checks and creates missing search attributes on startup.

```go
// In worker/worker.go - runs on every startup
searchattributes.EnsureSearchAttributesExist(ctx, temporalClient, namespace)
```

**Benefits**:
- ✅ Zero manual intervention
- ✅ Idempotent (safe to run multiple times)
- ✅ Fails gracefully if permissions restricted
- ✅ Works like database migrations

**Logs**:
```
INFO  Checking Temporal search attributes namespace=default required_attributes=1
INFO  Search attribute missing - will create attribute=WorkflowExecutionID type=Text
INFO  Creating search attribute attribute=WorkflowExecutionID
INFO  Successfully created search attribute attribute=WorkflowExecutionID
INFO  All required search attributes are now available
```

### 2. Standalone Script (For CI/CD)

Bash script for manual or automated setup:

```bash
cd backend/services/workflow-runner
./scripts/setup-temporal-search-attributes.sh default localhost:7233
```

**Use cases**:
- Pre-deployment verification
- CI/CD pipeline integration
- Manual setup in restricted environments
- Initial Temporal namespace configuration

**Features**:
- Colorized output
- Idempotent execution
- Handles race conditions
- Environment variable support

### 3. Manual CLI (Fallback)

For air-gapped or heavily restricted environments:

```bash
temporal operator search-attribute create \
  --namespace default \
  --address localhost:7233 \
  --name WorkflowExecutionID \
  --type Text
```

## Implementation Details

### Files Created

**Go Package** (`pkg/temporal/searchattributes/setup.go`):
```go
// EnsureSearchAttributesExist - idempotent setup
func EnsureSearchAttributesExist(ctx context.Context, client client.Client, namespace string)

// ValidateSearchAttributesSetup - fail-fast validation
func ValidateSearchAttributesSetup(ctx context.Context, client client.Client, namespace string)

// RequiredSearchAttributes - declarative list
var RequiredSearchAttributes = []RequiredSearchAttribute{
    {Name: "WorkflowExecutionID", Type: TEXT, Description: "..."},
}
```

**Standalone Script** (`scripts/setup-temporal-search-attributes.sh`):
- Bash script with colorized output
- Handles local and production environments
- Supports environment variable overrides
- Comprehensive error handling

**Test Script** (`scripts/test-search-attr-setup.sh`):
- Validates local Temporal connectivity
- Tests automated setup flow
- Verifies attribute creation
- Quick smoke test

**Documentation** (`_ops/setup-guides/06-temporal-search-attributes.md`):
- Detailed setup guide
- Troubleshooting section
- CI/CD integration examples
- Architecture diagrams

### Integration Points

**Worker Initialization** (`worker/worker.go`):
```go
func NewZigflowWorker(cfg *config.Config) (*ZigflowWorker, error) {
    // ... create Temporal client ...
    
    // Automatic setup (like DB migrations)
    ctx := context.Background()
    if err := searchattributes.EnsureSearchAttributesExist(ctx, temporalClient, cfg.TemporalNamespace); err != nil {
        log.Warn().Err(err).Msg("Failed to setup search attributes - may need manual setup")
        // Don't fail startup - graceful degradation
    }
    
    // ... continue with normal startup ...
}
```

**BUILD Files**:
- `pkg/temporal/searchattributes/BUILD.bazel`
- `pkg/converter/BUILD.bazel` (also created)
- `pkg/interceptors/BUILD.bazel` (also created)

### Required Search Attributes

| Name | Type | Purpose |
|------|------|---------|
| WorkflowExecutionID | Text | Stores WorkflowExecutionID for execution ID propagation from ExecuteServerlessWorkflow to ProgressReportingInterceptor |

**Why needed**:
- Activities can't access workflow context directly
- Search attributes propagate workflow metadata to activities
- Enables progress reporting without modifying activity signatures

## Behavior

### Development (Local)

```bash
# Start worker - automatic setup
bazel run //backend/services/workflow-runner:workflow_runner

# Output:
INFO  Connected to Temporal server
INFO  Checking Temporal search attributes namespace=default
INFO  All required search attributes exist
INFO  Starting Temporal worker system
```

**First run**: Creates missing attributes  
**Subsequent runs**: Validates and continues

### Production (Planton Cloud)

**First deployment**:
```bash
kubectl apply -f workflow-runner-deployment.yaml

# Worker logs:
INFO  Checking Temporal search attributes namespace=stigmer
INFO  Search attribute missing - will create attribute=WorkflowExecutionID
INFO  Successfully created search attribute
INFO  Starting Temporal worker system
```

**Subsequent deployments**: Instant validation, no creation needed

### Restricted Permissions

If automatic creation fails:

```bash
# Worker logs:
WARN  Failed to setup search attributes automatically - may need manual setup
WARN  See: _ops/setup-guides/06-temporal-search-attributes.md

# Admin runs:
./scripts/setup-temporal-search-attributes.sh stigmer temporal:7233
```

Worker continues to run - features requiring search attributes will log errors when used.

## Testing

### Automated Test

```bash
cd backend/services/workflow-runner
./scripts/test-search-attr-setup.sh
```

**Validates**:
1. Temporal connectivity
2. Setup script execution
3. Attribute creation
4. Idempotent behavior

### Manual Verification

```bash
# List search attributes
temporal operator search-attribute list \
  --namespace default \
  --address localhost:7233 | grep WorkflowExecutionID

# Expected:
#   WorkflowExecutionID    Text
```

## Benefits

**Before** (manual setup):
```
1. Deploy Temporal
2. Create namespace
3. [FORGOTTEN] Create search attributes ← often skipped
4. Deploy worker
5. Progress reporting silently fails
6. Debug for hours
7. Find missing search attribute
8. Create manually
9. Restart worker
```

**After** (automatic setup):
```
1. Deploy Temporal
2. Create namespace
3. Deploy worker → search attributes auto-created
4. Everything works
```

**Impact**:
- ✅ 8 steps → 3 steps
- ✅ Zero manual intervention
- ✅ No debugging mysterious failures
- ✅ Consistent across all environments
- ✅ Self-documenting (code is the doc)

## Troubleshooting

### "Failed to setup search attributes"

**Cause**: Temporal operator permissions required

**Solution**: Run standalone script with admin credentials

### "Attribute already exists" (during creation)

**Cause**: Race condition with another worker

**Solution**: This is normal and handled - both workers succeed

### "Type mismatch"

**Cause**: Attribute exists but wrong type

**Solution**: See troubleshooting guide in `_ops/setup-guides/06-temporal-search-attributes.md`

## Related Documentation

- **Setup Guide**: `_ops/setup-guides/06-temporal-search-attributes.md`
- **Implementation Status**: `IMPLEMENTATION_STATUS.md`
- **Progress Interceptor**: `pkg/interceptors/progress_interceptor.go`
- **Workflow Implementation**: `pkg/executor/temporal_workflow.go`

## Future Enhancements

**Possible additions**:
- [ ] Metrics for setup success/failure
- [ ] Health check endpoint for search attribute validation
- [ ] Support for multiple search attributes
- [ ] Custom attribute type validation
- [ ] Cleanup for unused attributes

**Not needed**:
- ❌ Migration tool (attributes don't change like DB schema)
- ❌ Rollback mechanism (attributes are additive)
- ❌ Version management (attributes are independent)

## Comparison to Database Migrations

| Aspect | DB Migrations | Search Attribute Setup |
|--------|---------------|------------------------|
| When runs | App startup | Worker startup |
| Frequency | Once per version | Every startup (with check) |
| Rollback | Complex | Not needed (additive) |
| Idempotency | Required | Built-in |
| Failure mode | Fail startup | Warn and continue |
| Schema changes | Common | Rare |

**Key difference**: Search attributes are schema that rarely changes, so we optimize for simplicity over version control.

## Summary

Search attribute setup is now **fully automated** with three options:

1. **Automatic** (default): Worker does it on startup
2. **Script**: Standalone script for CI/CD
3. **Manual**: CLI command for restricted environments

**Result**: One less thing to remember, one less thing to break.

---

**Like database migrations**: Schema automatically created when needed, not manually managed.
