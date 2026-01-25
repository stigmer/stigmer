# Skill Artifact Storage Architecture

## Overview

Stigmer stores skill artifacts (ZIP files containing SKILL.md + executables) using a secure, content-addressable storage system. This document explains how skill artifacts are uploaded, stored, and secured in Stigmer OSS (local daemon mode).

## What are Skill Artifacts?

A skill artifact is a ZIP file containing:
- **SKILL.md** (required): Interface definition, documentation, usage examples
- **Executables**: Python scripts, Bash scripts, Node.js tools, compiled binaries
- **Supporting files**: Configuration files, data files, libraries

**Example structure**:
```
calculator-skill/
├── SKILL.md           # Interface definition
├── calc.py            # Python implementation
├── requirements.txt   # Dependencies
└── README.md          # Additional docs
```

## Upload Flow

### 1. User Uploads Skill

```bash
$ cd my-skill/
$ stigmer apply

Detected SKILL.md - entering Artifact Mode

Skill name: my-skill
Creating skill artifact...
✓ Artifact created (12.4 KB)
Version hash: 7f3d2e1c9a8b5d4f...
Uploading skill artifact...
✓ Skill artifact uploaded successfully
```

### 2. CLI Processing

The CLI (T01.2):
1. Detects SKILL.md in current directory
2. Creates ZIP of directory (excludes .git, node_modules, etc.)
3. Calculates SHA256 hash of ZIP content
4. Uploads via `PushSkill` RPC to backend

### 3. Backend Processing

The backend (T01.3):
1. **Validates request**: Checks name, artifact, scope
2. **Normalizes name**: "My Skill" → "my-skill" (slug)
3. **Extracts SKILL.md**: Safely extracts content to memory (never to disk)
4. **Calculates hash**: SHA256 of ZIP content (content fingerprint)
5. **Checks for duplicates**: Same content = same hash = reuse existing file
6. **Stores artifact**: Writes sealed ZIP to `~/.stigmer/storage/skills/<hash>.zip`
7. **Updates database**: Saves metadata and SKILL.md text to BadgerDB
8. **Archives previous version**: If updating, saves snapshot to audit collection

## Content-Addressable Storage

### What is it?

Content-addressable storage means the filename is derived from the content (SHA256 hash):

```
Content: "calculator skill v1.0"
Hash:    7f3d2e1c9a8b5d4f3e2a1c9b8d7e6f5a4b3c2d1e
File:    ~/.stigmer/storage/skills/7f3d2e1c9a8b5d4f3e2a1c9b8d7e6f5a4b3c2d1e.zip
```

### Benefits

1. **Automatic Deduplication**:
   ```
   Upload 1: calculator-v1.0.zip (content: abc...) → hash: 7f3d2e...
   Upload 2: calculator-v2.0.zip (same content)   → hash: 7f3d2e... (reuse!)
   ```
   Same content = same hash = single file stored

2. **Content Integrity**:
   - Hash verifies content hasn't been tampered with
   - Can't modify file without changing hash

3. **Immutability**:
   - Once stored, artifacts never change
   - Multiple skills/versions can reference same artifact

## Security Model

### Question: Can malicious executables harm the backend?

**Answer**: ❌ **No!** The backend never extracts or executes skill artifacts.

### Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Backend Server (Stigmer OSS)                                │
│                                                             │
│ 1. Receives ZIP ✓                                          │
│ 2. Validates ZIP (google/safearchive) ✓                    │
│ 3. Extracts SKILL.md to MEMORY only ✓                      │
│ 4. Stores sealed ZIP (never extracts executables) ✓        │
│ 5. Returns metadata ✓                                      │
│                                                             │
│ ❌ Executables NEVER touch backend filesystem              │
│ ❌ Executables NEVER execute on backend                    │
└─────────────────────────────────────────────────────────────┘
                          ↓ (downloads sealed ZIP)
┌─────────────────────────────────────────────────────────────┐
│ Agent Sandbox (Docker/Daytona)                             │
│                                                             │
│ 1. Downloads ZIP from backend ✓                            │
│ 2. Extracts ZIP INSIDE sandbox ✓                           │
│ 3. Executes tools INSIDE sandbox ✓                         │
│ 4. Isolated from host system ✓                             │
│                                                             │
│ ✅ Executables run in isolated environment                 │
│ ✅ No access to host filesystem/network                    │
└─────────────────────────────────────────────────────────────┘
```

### Security Measures

#### 1. google/safearchive

Industry-standard library by Google that prevents:
- **Path traversal attacks**: `../../../etc/passwd` → Blocked
- **Symlink attacks**: Symlinks in ZIP → Blocked
- **MaximumSecurityMode**: All protections enabled

#### 2. ZIP Bomb Protection

Prevents attackers from crashing the server:
- **Max compressed size**: 100MB
- **Max uncompressed size**: 500MB
- **Max compression ratio**: 100:1 per file
- **Max files in ZIP**: 10,000

Example attack prevented:
```
Malicious ZIP: 1MB → expands to 10GB
Result: Rejected (exceeds 500MB limit)
```

#### 3. SKILL.md Extraction Strategy

- **Extracted to memory only** (never written to disk)
- **Size limited to 1MB** (prevents memory exhaustion)
- **Content stored in database** (for prompt injection)
- **Executables remain sealed in ZIP** (never extracted on backend)

#### 4. File Permissions

```bash
$ ls -la ~/.stigmer/storage/skills/
-rw------- 1 user user 12345 Jan 25 15:18 7f3d2e1c....zip  # 0600 permissions
```

- Only owner can read/write (0600)
- Other users have no access

### Attack Vectors Mitigated

| Attack | How It Works | Mitigation |
|--------|-------------|------------|
| **Path Traversal** | ZIP contains `../../../etc/passwd` to overwrite system files | google/safearchive blocks all `../` paths |
| **Symlink Attack** | ZIP contains symlink to `/etc/shadow` | google/safearchive blocks symlinks |
| **ZIP Bomb** | 1MB file expands to 10GB to crash server | Size and ratio limits reject it |
| **Memory Exhaustion** | Huge SKILL.md file exhausts RAM | 1MB size limit for SKILL.md |
| **File Flood** | 100,000 tiny files to exhaust inodes | Max 10,000 files per ZIP |
| **Malicious Executable** | Trojan binary uploaded to backend | Never extracted, stored sealed |

## Storage Layout

### File System

```
~/.stigmer/
├── stigmer.db/                    # BadgerDB database
└── storage/
    └── skills/
        ├── 7f3d2e1c...zip         # Sealed artifact (hash 1)
        ├── a9f2b1c4...zip         # Sealed artifact (hash 2)
        └── d8e3f7a2...zip         # Sealed artifact (hash 3)
```

### BadgerDB Schema

#### Main Collection

Stores current state of each skill:

```
Key: skill/platform/skill/my-skill

Value: {
  "api_version": "agentic.stigmer.ai/v1",
  "kind": "Skill",
  "metadata": {
    "id": "platform/skill/my-skill",
    "name": "my-skill",
    "slug": "my-skill",
    "owner_scope": "platform"
  },
  "spec": {
    "skill_md": "# My Skill\n\nDescription...",  ← Extracted text
    "tag": "latest"
  },
  "status": {
    "version_hash": "7f3d2e1c9a8b5d4f...",        ← SHA256 of ZIP
    "artifact_storage_key": "skills/7f3d2e1c...zip",
    "state": "READY",
    "audit": {
      "spec_audit": {"created_at": "...", "updated_at": "..."},
      "status_audit": {"created_at": "...", "updated_at": "..."}
    }
  }
}
```

#### Audit Collection

Preserves version history (immutable snapshots):

```
Key: skill_audit/platform/skill/my-skill/1738000000000  ← timestamp

Value: {previous version snapshot}
```

**Queries**:
- **Current version**: Query main collection by skill ID
- **Version by tag**: Query audit collection by tag, sort by timestamp (latest)
- **Version by hash**: Query audit collection by version_hash (exact match)
- **Version history**: Query audit collection by skill ID, sort by timestamp

## Audit Trail

### Pattern: Manual Wrapper

Before every update, the backend explicitly archives the current version:

```go
func (c *SkillController) Push(ctx context.Context, req *PushSkillRequest) (*PushSkillResponse, error) {
    // 1. Check if skill exists
    existingSkill, err := c.store.GetResource(ctx, skillID)
    
    if err == nil {
        // 2. Skill exists - archive current version before updating
        if err := c.archiveSkill(ctx, existingSkill); err != nil {
            // Log warning but don't fail (best-effort)
        }
        
        // 3. Update to new version
        existingSkill.Spec.SkillMd = newContent
        existingSkill.Spec.Tag = newTag
        existingSkill.Status.VersionHash = newHash
    }
    
    // 4. Save updated skill
    c.store.SaveResource(ctx, skillID, skill)
}

func (c *SkillController) archiveSkill(ctx context.Context, skill *Skill) error {
    timestamp := time.Now().UnixNano()
    auditKey := fmt.Sprintf("skill_audit/%s/%d", skill.Metadata.Id, timestamp)
    return c.store.SaveResource(ctx, auditKey, skill)
}
```

### Why Manual Wrapper?

**BadgerDB has no built-in CDC or triggers** (unlike MongoDB Change Streams).

Manual wrapper is:
- ✅ Explicit and reliable
- ✅ Easy to understand
- ✅ Simple to implement
- ✅ Called before every update

## Version Resolution

When an agent needs a skill, version resolution happens:

```
User specifies version:
├─ Empty/unset → "latest" (main collection, current version)
├─ "latest" → Main collection (current version)
├─ "stable" (tag) → Check main, then audit (latest with tag "stable")
└─ "7f3d2e1c..." (hash) → Check main, then audit (exact hash match)
```

**Implementation** (to be done in T01.4):
```go
func ResolveSkillVersion(slug string, version string) (*Skill, error) {
    if version == "" || version == "latest" {
        return GetCurrentSkill(slug)  // Main collection
    }
    
    if IsHashFormat(version) {
        return GetSkillByHash(slug, version)  // Exact match
    }
    
    return GetSkillByTag(slug, version)  // Tag, sorted by timestamp
}
```

## Performance Considerations

### Deduplication Savings

Example:
```
100 users upload "calculator-skill" (same content):
- Without deduplication: 100 files × 10MB = 1GB storage
- With deduplication: 1 file × 10MB = 10MB storage (99% savings!)
```

### Hash Calculation

- SHA256 is fast (~500 MB/s on modern CPUs)
- Calculated once during upload (CLI) and verified on backend
- Cached in database (no recalculation needed)

### Storage Access Patterns

- **Writes**: Rare (only on skill push)
- **Reads**: Common (agent downloads)
- **Optimization**: Consider caching frequently accessed artifacts in memory

## Future Enhancements

### Cloud Storage Support

The storage abstraction is designed for easy extension:

```go
// Already implemented:
type ArtifactStorage interface {
    Store(hash string, data []byte) (storageKey string, err error)
    Get(storageKey string) (data []byte, err error)
    Exists(hash string) (bool, error)
}

type LocalFileStorage struct { ... }  // ✅ Implemented

// Easy to add:
type CloudBucketStorage struct {
    r2Client *r2.Client  // CloudFlare R2
}

func (s *CloudBucketStorage) Store(hash string, data []byte) (string, error) {
    key := fmt.Sprintf("skills/%s.zip", hash)
    return key, s.r2Client.Upload(key, data)
}
```

**Configuration-driven selection**:
```yaml
# Stigmer config
storage:
  mode: cloud           # local | cloud
  cloud:
    provider: r2        # r2 | s3
    bucket: stigmer-skills
```

### Query Operations (T01.4)

Currently implemented:
- ✅ Push (upload skill artifact)

To be implemented:
- ⏳ GetByTag (query by tag name)
- ⏳ GetByHash (query by exact hash)
- ⏳ FindAll (list all skills)

## Related Documentation

- **Getting Started**: See [Local Mode](../getting-started/local-mode.md) for skill upload instructions
- **CLI**: See [CLI Documentation](../guides/cli-usage.md) for `stigmer apply` usage
- **Security**: See [Security Model](security-model.md) for overall security architecture
- **API**: See [Skill API](../api/skill-api.md) for gRPC API reference

## Implementation

- **Proto Definitions**: `apis/ai/stigmer/agentic/skill/v1/`
- **CLI Artifact Upload**: `client-apps/cli/internal/cli/artifact/skill.go`
- **Backend Storage**: `backend/services/stigmer-server/pkg/domain/skill/storage/`
- **Backend Handler**: `backend/services/stigmer-server/pkg/domain/skill/controller/push.go`

## References

- **Design Decisions**:
  - `_projects/2026-01/20260125.01.skill-api-enhancement/design-decisions/01-skill-proto-structure.md`
  - `_projects/2026-01/20260125.01.skill-api-enhancement/design-decisions/02-api-resource-reference-versioning.md`
- **Checkpoints**:
  - `_projects/2026-01/20260125.01.skill-api-enhancement/checkpoints/2026-01-25-t01-2-cli-enhancement-complete.md`
  - `_projects/2026-01/20260125.01.skill-api-enhancement/checkpoints/2026-01-25-t01-3-backend-implementation-complete.md`
- **Changelog**: `_changelog/2026-01/2026-01-25-151850-implement-skill-backend-secure-storage.md`

---

**Note**: This document describes the OSS (local daemon) implementation. The cloud version (Java/MongoDB/CloudFlare R2) will have similar architecture with different storage backend.
