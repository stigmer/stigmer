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
Abstraction for external storage backends (Cloudflare R2, S3, etc.)

### R2Store (`r2_store.go`)
Cloudflare R2 implementation using AWS SDK (R2 is S3-compatible)

### Compressor (`compressor.go`)
Gzip compression for text payloads to reduce storage costs and improve performance

### ClaimCheckRef (`reference.go`)
Reference structure that replaces large payloads in Temporal state

### Manager (`manager.go`)
Orchestrates offload/retrieval decisions and integrates with Temporal workflow context

### Metrics (`metrics.go`)
Tracks performance metrics (offload count, retrieval count, latency, storage usage)

## Configuration

Environment variables:

```bash
# Enable Claim Check
CLAIMCHECK_ENABLED=true

# Offload payloads larger than this (bytes)
CLAIMCHECK_THRESHOLD_BYTES=51200  # 50KB

# Enable gzip compression
CLAIMCHECK_COMPRESSION_ENABLED=true

# Auto-delete after N days
CLAIMCHECK_TTL_DAYS=30

# Cloudflare R2 Configuration
R2_BUCKET=your-bucket-name
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_REGION=auto
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
```

## Usage Example

```go
package main

import (
    "context"
    "github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/claimcheck"
    "go.temporal.io/sdk/workflow"
)

func MyWorkflow(ctx workflow.Context) error {
    // Initialize ClaimCheckManager
    cfg := claimcheck.Config{
        ThresholdBytes:     50 * 1024, // 50KB
        CompressionEnabled: true,
        TTLDays:            30,
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

## Storage Backend

**Cloudflare R2** is used for all environments (dev, staging, prod):

- **Zero egress fees** (cost advantage over AWS S3)
- **S3-compatible API** (uses AWS SDK)
- **Globally distributed**
- **Cost-effective storage**

## Testing

Run unit tests:

```bash
cd pkg/claimcheck
go test -v
```

Run benchmarks:

```bash
go test -bench=. -benchmem
```

Run integration tests (requires R2 credentials):

```bash
export R2_BUCKET=test-bucket
export R2_ENDPOINT=https://test.r2.cloudflarestorage.com
export R2_ACCESS_KEY_ID=test-key
export R2_SECRET_ACCESS_KEY=test-secret

go test -v
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
