You have correctly identified the three biggest friction points in moving the Workflow Runner to "Local Daemon" mode:

1. **The R2 Dependency (Claim Check):** You cannot ask local users to use Cloudflare R2. You need a Local File System adapter.
2. **The Endpoint:** The Runner needs to talk to your Daemon (`localhost:50051`), not a remote URL.
3. **The Configuration Injection:** Since the Workflow Runner runs as a **Goroutine inside the Daemon**, it shouldn't rely solely on global OS Environment Variables (which might conflict). It should accept a Config struct passed from the Daemon.

Here is the strategy and the ADR implementation plan for Cursor.

### The Strategy: "Abstract and Inject"

Currently, your code likely imports the S3/R2 library directly. We will refactor this into a **Storage Interface**.

* **Cloud Mode:** Injects `S3BlobStore` (talks to R2).
* **Local Mode:** Injects `FileBlobStore` (talks to `.stigmer/blobs` folder).

---

### Architecture Decision Record (ADR)

Submit this document to Cursor to guide the refactoring.

# ADR 015: Abstracting Claim Check Storage (Local Files vs. Cloud R2)

**Status**: Accepted
**Date**: January 19, 2026
**Context**:

* The Workflow Runner currently hardcodes Cloudflare R2 (S3 compatible) for "Claim Checks" (storing large payloads that exceed Temporal's limit).
* **Problem**: In Local Mode, users do not have R2 credentials. They need a zero-config solution.
* **Goal**: Enable the Workflow Runner to store Claim Check payloads on the local disk when running in `ENV=local`, while maintaining R2 support for `ENV=cloud`.

**Decision**:
We will implement the **Strategy Pattern** for Blob Storage.

1. Define a `BlobStore` interface.
2. Implement a `FileBlobStore` driver for local disk usage.
3. Update the Workflow Runner configuration to select the driver based on the environment.

## Implementation Plan

### 1. Define the Interface

Create `pkg/blobstore/interface.go`:

```go
package blobstore

import (
    "context"
    "io"
)

type BlobStore interface {
    // Uploads data and returns a reference key
    Put(ctx context.Context, bucket string, key string, data []byte) error
    
    // Downloads data using the reference key
    Get(ctx context.Context, bucket string, key string) ([]byte, error)
    
    // Checks if the service is healthy/accessible
    Ping(ctx context.Context) error
}

```

### 2. Implement the Local Driver

Create `pkg/blobstore/filesystem/store.go`:

```go
package filesystem

import (
    "os"
    "path/filepath"
    // ... imports
)

type FileStore struct {
    BasePath string // e.g. ~/.stigmer/data/blobs
}

func New(basePath string) *FileStore {
    os.MkdirAll(basePath, 0755)
    return &FileStore{BasePath: basePath}
}

func (f *FileStore) Put(ctx context.Context, bucket string, key string, data []byte) error {
    // We ignore 'bucket' locally, or use it as a subfolder
    fullPath := filepath.Join(f.BasePath, bucket, key)
    if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
        return err
    }
    return os.WriteFile(fullPath, data, 0644)
}

func (f *FileStore) Get(ctx context.Context, bucket string, key string) ([]byte, error) {
    fullPath := filepath.Join(f.BasePath, bucket, key)
    return os.ReadFile(fullPath)
}

```

### 3. Update Configuration Logic

Refactor the Workflow Runner's startup logic to switch drivers.

**New Config Struct:**

```go
type Config struct {
    // ... existing fields
    BlobStorageType string // "s3" or "filesystem"
    LocalBlobPath   string // Used only if type is filesystem
}

```

**Initialization Logic (pseudo-code):**

```go
func NewClaimCheckService(cfg Config) BlobStore {
    if cfg.BlobStorageType == "filesystem" {
        return filesystem.New(cfg.LocalBlobPath)
    }
    // Default to S3/R2
    return s3.New(cfg.R2Endpoint, cfg.R2AccessKey, ...)
}

```

## Impact on Environment Variables

* **New Env Var**: `BLOB_STORAGE_TYPE` (Values: `filesystem`, `s3`).
* **Deprecated locally**: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` are ignored when type is `filesystem`.

---

### Specific Answers to Your Setup Questions

Here is how you handle the specific variables you listed for the **Local Daemon** setup:

#### 1. The Endpoint (`STIGMER_BACKEND_ENDPOINT`)

* **Old Value:** `localhost:8080` (This was your Cloud/Docker service).
* **New Value:** `localhost:50051` (This is your Go Daemon's gRPC port).
* **Auth:** You mentioned `STIGMER_API_KEY`.
* **In Go:** Update your gRPC client initialization. If `ENV=local`, skip the code that adds the `Authorization: Bearer <key>` header. Or, simpler: keep the code, but pass `STIGMER_API_KEY=dummy`. The local Daemon (server) won't check it anyway.



#### 2. The R2 Variables

* **Set** `BLOB_STORAGE_TYPE=filesystem`.
* **Set** `R2_BUCKET=local-claimcheck` (The file system driver can use this as a folder name).
* **Unset** `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

#### 3. OTEL (OpenTelemetry)

* **Keep it?** You can keep `OTEL_SERVICE_NAME=workflow-runner`.
* **Usage:** Since you set `OTEL_EXPORTER_OTLP_TRANSPORT=http` and usually local devs don't run an OTEL collector (Jaeger/Zipkin), the traces will likely be dropped silently, which is fine.
* **Cleanup:** You can set `OTEL_TRACES_EXPORTER=none` locally to stop it from trying to connect and logging errors.

### The Final "Local" Config Map

When your Daemon starts the embedded Workflow Runner, it should programmatically construct a config struct equivalent to these values. **You do not need to export these in your terminal.**

```go
// Inside daemon/main.go
runnerConfig := workflow.Config{
    Env:                        "local",
    TemporalAddress:            "localhost:7233",
    StigmerBackend:             "localhost:50051", // Points to self
    UseTLS:                     false,
    
    // The Fix for R2:
    BlobStorageType:            "filesystem",
    BlobStoragePath:            filepath.Join(homeDir, ".stigmer", "data", "blobs"),
    
    // Claim Check Settings
    ClaimCheckEnabled:          true,
    ClaimCheckThresholdBytes:   51200,
    
    // Tuning (Lower for local laptop)
    MaxConcurrentTasks:         10, 
}

// Start the runner with this struct, NOT by reading os.Getenv()
go workflow.StartWorker(ctx, runnerConfig)

```

**Task for you:**
Submit **ADR 015** to Cursor. It gives the AI the exact instruction to create the `FileSystem` implementation and decouple your code from R2.