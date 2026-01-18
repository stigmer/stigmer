# Tasks: Workflow Runner Local Mode

## Task 1: Implement FilesystemStore ✅ DONE

**Goal**: Create `filesystem_store.go` implementing the ObjectStore interface for local disk storage.

**Location**: `backend/services/workflow-runner/pkg/claimcheck/filesystem_store.go`

### Requirements

Implement all ObjectStore interface methods:

```go
type FilesystemStore struct {
    basePath string
}

func NewFilesystemStore(basePath string) (*FilesystemStore, error)
func (f *FilesystemStore) Put(ctx context.Context, data []byte) (string, error)
func (f *FilesystemStore) Get(ctx context.Context, key string) ([]byte, error)
func (f *FilesystemStore) Delete(ctx context.Context, key string) error
func (f *FilesystemStore) Health(ctx context.Context) error
func (f *FilesystemStore) ListKeys(ctx context.Context) ([]string, error)
```

### Implementation Details

1. **Storage Location**: `~/.stigmer/data/blobs/` (or configurable path)
2. **Key Generation**: UUID-based (same as R2Store)
3. **File Operations**: Use `os.WriteFile`, `os.ReadFile`, `os.Remove`
4. **Directory Creation**: Auto-create base path if missing
5. **Error Handling**: Wrap errors with context (e.g., "filesystem put failed")

### Acceptance Criteria

- [x] All interface methods implemented
- [x] Auto-creates storage directory if missing
- [x] Returns descriptive errors with context
- [x] Follows same patterns as R2Store
- [x] Code compiles without errors

---

## Task 2: Update Config & Manager ✅ DONE

**Goal**: Add storage type selection and update Manager to choose between R2 and filesystem stores.

### Part A: Update Config Structure

**Location**: `backend/services/workflow-runner/pkg/claimcheck/store.go`

Add to `Config` struct:
```go
type Config struct {
    // ... existing fields ...
    
    // Storage backend selection
    StorageType string // "r2" or "filesystem"
    
    // Filesystem configuration (used when StorageType = "filesystem")
    FilesystemBasePath string // e.g. ~/.stigmer/data/blobs
}
```

### Part B: Update Manager.NewManager()

**Location**: `backend/services/workflow-runner/pkg/claimcheck/manager.go`

Replace hardcoded R2 initialization with storage selection:

```go
func NewManager(cfg Config) (*Manager, error) {
    ctx := context.Background()
    
    var store ObjectStore
    var err error
    
    // Select storage backend based on config
    switch cfg.StorageType {
    case "filesystem":
        store, err = NewFilesystemStore(cfg.FilesystemBasePath)
        if err != nil {
            return nil, fmt.Errorf("failed to initialize filesystem store: %w", err)
        }
    case "r2", "": // Default to R2 for backward compatibility
        store, err = NewR2Store(ctx, cfg)
        if err != nil {
            return nil, fmt.Errorf("failed to initialize R2 store: %w", err)
        }
    default:
        return nil, fmt.Errorf("unknown storage type: %s", cfg.StorageType)
    }
    
    // ... rest of initialization unchanged ...
}
```

### Part C: Environment Variable Loading

**Location**: Find where Config is loaded from environment (likely in `main.go` or config loading code)

Add:
```go
StorageType:       getEnv("BLOB_STORAGE_TYPE", "r2"), // Default to R2
FilesystemBasePath: getEnv("BLOB_STORAGE_PATH", 
    filepath.Join(os.Getenv("HOME"), ".stigmer", "data", "blobs")),
```

### Acceptance Criteria

- [x] Config struct has StorageType and FilesystemBasePath fields
- [x] Manager.NewManager() selects store based on StorageType
- [ ] Environment variables loaded properly (deferred to Task 4/5)
- [x] Defaults to R2 for backward compatibility
- [x] Returns error for unknown storage types
- [x] Code compiles without errors

---

## Task 3: Add Unit Tests ✅ DONE

**Goal**: Create comprehensive unit tests for FilesystemStore covering all operations.

**Location**: `backend/services/workflow-runner/pkg/claimcheck/filesystem_store_test.go`

### Test Coverage

```go
func TestFilesystemStore_New(t *testing.T)
func TestFilesystemStore_Put(t *testing.T)
func TestFilesystemStore_Get(t *testing.T)
func TestFilesystemStore_Delete(t *testing.T)
func TestFilesystemStore_Health(t *testing.T)
func TestFilesystemStore_ListKeys(t *testing.T)
func TestFilesystemStore_PutGet_RoundTrip(t *testing.T)
func TestFilesystemStore_GetNonexistent(t *testing.T)
func TestFilesystemStore_DeleteNonexistent(t *testing.T)
```

### Test Patterns

Use temp directories for isolation:
```go
func TestFilesystemStore_Put(t *testing.T) {
    tmpDir := t.TempDir()
    store, err := NewFilesystemStore(tmpDir)
    require.NoError(t, err)
    
    data := []byte("test payload")
    key, err := store.Put(context.Background(), data)
    require.NoError(t, err)
    require.NotEmpty(t, key)
    
    // Verify file exists
    path := filepath.Join(tmpDir, key)
    require.FileExists(t, path)
}
```

### Acceptance Criteria

- [x] All ObjectStore methods have tests
- [x] Tests use temporary directories (cleaned up automatically)
- [x] Error cases covered (nonexistent files, etc.)
- [x] Round-trip tests (Put → Get → verify)
- [x] All tests pass

---

## Task 4: Update Documentation ✅ DONE

**Goal**: Document local mode setup and environment variables.

### Part A: Update Claim Check README

**Location**: `backend/services/workflow-runner/pkg/claimcheck/README.md`

Add section:
```markdown
## Local Mode (Filesystem Storage)

For local development without Cloudflare R2:

### Configuration

```bash
# Use filesystem storage instead of R2
BLOB_STORAGE_TYPE=filesystem

# Storage location (optional, defaults to ~/.stigmer/data/blobs)
BLOB_STORAGE_PATH=/path/to/storage

# Claim check settings (same as cloud mode)
CLAIMCHECK_ENABLED=true
CLAIMCHECK_THRESHOLD_BYTES=51200
CLAIMCHECK_COMPRESSION_ENABLED=true
```

### How It Works

- Payloads stored as files with UUID names
- Auto-creates storage directory
- No cloud credentials needed
- Same ObjectStore interface as R2
```

### Part B: Update Environment Variables Section

Document all storage-related variables:
```markdown
## Storage Backend Configuration

### Cloud Mode (R2)
```bash
BLOB_STORAGE_TYPE=r2  # or unset (defaults to r2)
R2_BUCKET=your-bucket-name
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_REGION=auto
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
```

### Local Mode (Filesystem)
```bash
BLOB_STORAGE_TYPE=filesystem
BLOB_STORAGE_PATH=~/.stigmer/data/blobs  # optional
```
```

### Acceptance Criteria

- [x] README has local mode section
- [x] Environment variables documented
- [x] Examples provided for both modes
- [x] Clear instructions for switching modes

---

## Task 5: Integration Testing ⏸️ TODO

**Goal**: Verify local mode works end-to-end with claim check flow.

### Manual Test Plan

1. **Setup Local Mode**:
   ```bash
   export BLOB_STORAGE_TYPE=filesystem
   export BLOB_STORAGE_PATH=/tmp/stigmer-test-blobs
   export CLAIMCHECK_ENABLED=true
   export CLAIMCHECK_THRESHOLD_BYTES=1024  # 1KB for easy testing
   ```

2. **Start Workflow Runner**:
   ```bash
   cd backend/services/workflow-runner
   go run main.go
   ```

3. **Execute Test Workflow**:
   - Create workflow with >1KB payload
   - Verify payload offloaded (check logs)
   - Verify file created in `/tmp/stigmer-test-blobs/`
   - Verify workflow completes successfully
   - Verify payload retrieved correctly

4. **Verify Files**:
   ```bash
   ls -lh /tmp/stigmer-test-blobs/
   # Should show UUID-named files
   ```

5. **Check Metrics**:
   - Verify OffloadCount incremented
   - Verify RetrievalCount incremented
   - Verify storage path correct

### Acceptance Criteria

- [ ] Workflow runner starts successfully in filesystem mode
- [ ] Large payloads offloaded to filesystem
- [ ] Files created with UUID names
- [ ] Payloads retrieved correctly by activities
- [ ] Workflow completes without errors
- [ ] Metrics track operations correctly

---

## Progress Summary

- ⏸️ TODO: Task 5 (Integration Testing - manual verification)
- 🚧 IN PROGRESS: None
- ✅ DONE: Tasks 1-4

**Next**: Task 5 (Integration Testing) - Manual verification step
