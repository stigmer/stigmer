# Claim Check Pattern for Large Payloads

This package implements the **Claim Check Pattern** to prevent Temporal payload overflow errors when AI agents generate massive contexts (100K+ tokens ≈ 400KB).

## What is the Claim Check Pattern?

The Claim Check Pattern intercepts large activity outputs, stores them externally in Cloudflare R2 (S3-compatible storage), and replaces them with lightweight references in the workflow state.

**Traditional Flow:**
```
Activity → [400KB Result] → Temporal State → Next Activity
                           ❌ Fails with BlobSizeExceeded
```

**Claim Check Flow:**
```
Activity → [400KB Result] → Check Size → Upload to R2 → [8-byte Reference] → Temporal State
                                                                                    ↓
                                                                           Next Activity
                                                                                    ↓
                                                                  Download from R2 → [400KB Result]
                                                                          ✅ Success
```

## Components

### ObjectStore Interface (`store.go`)
Abstraction for external storage backends (Cloudflare R2, filesystem, etc.)

### R2Store (`r2_store.go`)
Cloudflare R2 implementation using AWS SDK (R2 is S3-compatible)

### FilesystemStore (`filesystem_store.go`)
Local filesystem implementation for development without cloud dependencies

### Compressor (`compressor.go`)
Gzip compression for text payloads to reduce storage costs and improve performance

### ClaimCheckRef (`reference.go`)
Reference structure that replaces large payloads in Temporal state

### Manager (`manager.go`)
Orchestrates offload/retrieval decisions and integrates with Temporal workflow context

### Metrics (`metrics.go`)
Tracks performance metrics (offload count, retrieval count, latency, storage usage)

## Configuration

### Common Settings

```bash
# Enable Claim Check
CLAIMCHECK_ENABLED=true

# Offload payloads larger than this (bytes)
CLAIMCHECK_THRESHOLD_BYTES=51200  # 50KB

# Enable gzip compression
CLAIMCHECK_COMPRESSION_ENABLED=true

# Auto-delete after N days
CLAIMCHECK_TTL_DAYS=30
```

### Storage Backend Configuration

#### Local Mode (Filesystem)

For local development without cloud credentials:

```bash
# Use filesystem storage
BLOB_STORAGE_TYPE=filesystem

# Storage location (optional, defaults to ~/.stigmer/data/blobs)
BLOB_STORAGE_PATH=/path/to/storage
```

**How it works:**
- Payloads stored as files with UUID names
- Auto-creates storage directory if missing
- No cloud credentials needed
- Same ObjectStore interface as R2

**When to use:**
- Local development
- Testing without cloud dependencies
- CI/CD environments without R2 access

#### Cloud Mode (Cloudflare R2)

For production deployments (default if `BLOB_STORAGE_TYPE` not set):

```bash
# Use R2 storage (or omit - defaults to r2)
BLOB_STORAGE_TYPE=r2

# Cloudflare R2 Configuration
R2_BUCKET=your-bucket-name
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_REGION=auto
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
```

**When to use:**
- Production environments
- Staging environments
- Any shared deployment requiring durable storage

## Usage Examples

### Using Filesystem Storage (Local Mode)

```go
package main

import (
    "context"
    "os"
    "path/filepath"
    "github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/claimcheck"
    "go.temporal.io/sdk/workflow"
)

func MyWorkflow(ctx workflow.Context) error {
    // Initialize ClaimCheckManager with filesystem storage
    cfg := claimcheck.Config{
        ThresholdBytes:     50 * 1024, // 50KB
        CompressionEnabled: true,
        StorageType:        "filesystem",
        FilesystemBasePath: filepath.Join(os.Getenv("HOME"), ".stigmer", "data", "blobs"),
    }
    
    manager, err := claimcheck.NewManager(cfg)
    if err != nil {
        return err
    }
    
    // Execute activity
    var result []byte
    err = workflow.ExecuteActivity(ctx, MyActivity).Get(ctx, &result)
    if err != nil {
        return err
    }
    
    // MaybeOffload checks size and offloads if > threshold
    stored, err := manager.MaybeOffload(ctx, result)
    if err != nil {
        return err
    }
    
    // Later: MaybeRetrieve checks if it's a reference and retrieves
    retrieved, err := manager.MaybeRetrieve(ctx, stored)
    if err != nil {
        return err
    }
    
    return nil
}
```

### Using R2 Storage (Cloud Mode)

```go
package main

import (
    "context"
    "github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/claimcheck"
    "go.temporal.io/sdk/workflow"
)

func MyWorkflow(ctx workflow.Context) error {
    // Initialize ClaimCheckManager with R2 storage
    cfg := claimcheck.Config{
        ThresholdBytes:     50 * 1024, // 50KB
        CompressionEnabled: true,
        StorageType:        "r2", // or omit - defaults to r2
        R2Bucket:           "my-bucket",
        R2Endpoint:         "https://abc123.r2.cloudflarestorage.com",
        R2AccessKeyID:      "my-key",
        R2SecretAccessKey:  "my-secret",
        R2Region:           "auto",
    }
    
    manager, err := claimcheck.NewManager(cfg)
    if err != nil {
        return err
    }
    
    // Execute activity
    var result []byte
    err = workflow.ExecuteActivity(ctx, MyActivity).Get(ctx, &result)
    if err != nil {
        return err
    }
    
    // MaybeOffload checks size and offloads if > threshold
    stored, err := manager.MaybeOffload(ctx, result)
    if err != nil {
        return err
    }
    
    // Later: MaybeRetrieve checks if it's a reference and retrieves
    retrieved, err := manager.MaybeRetrieve(ctx, stored)
    if err != nil {
        return err
    }
    
    return nil
}
```

## Performance Characteristics

- **Upload latency**: < 500ms for 1MB payload
- **Download latency**: < 200ms for 1MB payload
- **Compression ratio**: > 50% for text payloads
- **Total overhead**: < 1 second per large payload

## Storage Backends

### Filesystem (Local Mode)

**When to use:**
- Local development
- Testing without cloud dependencies
- CI/CD environments

**Advantages:**
- No cloud credentials needed
- Fast local I/O
- Zero cloud costs
- Simple setup

**Limitations:**
- Not suitable for production (data lost on restart)
- No data replication
- No automatic TTL cleanup

### Cloudflare R2 (Cloud Mode)

**When to use:**
- Production deployments
- Staging environments
- Shared/distributed systems

**Advantages:**
- Zero egress fees (cost advantage over AWS S3)
- S3-compatible API (uses AWS SDK)
- Globally distributed
- Cost-effective storage
- Automatic TTL cleanup via lifecycle policies

**Recommended for:**
- All production workloads
- Long-running workflows
- Multi-instance deployments

## Testing

Run all unit tests:

```bash
cd pkg/claimcheck
go test -v
```

Run only filesystem tests:

```bash
go test -v -run TestFilesystemStore
```

Run only R2 tests (requires R2 credentials):

```bash
export R2_BUCKET=test-bucket
export R2_ENDPOINT=https://test.r2.cloudflarestorage.com
export R2_ACCESS_KEY_ID=test-key
export R2_SECRET_ACCESS_KEY=test-secret

go test -v -run TestR2Store
```

Run benchmarks:

```bash
go test -bench=. -benchmem
```

## Metrics

The ClaimCheckManager tracks the following metrics:

- `OffloadCount`: Number of payloads offloaded
- `RetrievalCount`: Number of payloads retrieved
- `TotalBytesStored`: Total storage used
- `AvgUploadLatencyMS`: Average upload latency
- `AvgDownloadLatencyMS`: Average download latency

Access metrics:

```go
snapshot := manager.Metrics()
fmt.Printf("Offloaded: %d payloads\n", snapshot.OffloadCount)
fmt.Printf("Retrieved: %d payloads\n", snapshot.RetrievalCount)
fmt.Printf("Storage: %d bytes\n", snapshot.TotalBytesStored)
```

## Architecture Decision

Why Claim Check instead of alternatives?

**✅ Claim Check (chosen)**:
- Transparent to workflow logic
- Works with any payload size
- Automatic compression
- Low latency overhead

**❌ Alternatives considered**:
- **Streaming**: Complex API changes, not supported by Temporal
- **Chunking**: Requires workflow logic changes
- **External coordination**: Adds complexity and failure modes

## Related Documentation

- [Phase 2 Execution Plan](../../../../_projects/2026-01-08-workflow-orchestration-engine/phase-2-execution-plan.md)
- [Claim Check Architecture](../../docs/CLAIMCHECK-ARCHITECTURE.md)
- [Claim Check Testing](../../docs/CLAIMCHECK-TESTING.md)

## License

Apache License 2.0
