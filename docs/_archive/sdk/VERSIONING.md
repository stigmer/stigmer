# Stigmer SDK Versioning Strategy

## Unified Versioning Approach

The Stigmer SDK uses **unified versioning** across all language implementations. All SDKs (Go, Python, etc.) share the same version number.

### Module Structure

```
stigmer-sdk/
  ├── go.mod              ← Root-level module
  ├── go/                 ← Go implementation
  │   ├── agent/
  │   ├── workflow/
  │   └── ...
  ├── python/             ← Python implementation
  │   └── ...
  └── README.md
```

**Module path:** `github.com/leftbin/stigmer-sdk`

**Import paths:** 
- `github.com/leftbin/stigmer-sdk/go/agent`
- `github.com/leftbin/stigmer-sdk/go/workflow`

### Version Tagging

**✅ Simple unified tags:**
```bash
git tag v0.2.0
git push origin v0.2.0
```

**❌ No subdirectory prefixes needed:**
```bash
git tag go/v0.2.0  # NOT needed anymore!
```

### Why Unified Versioning?

1. **Simplicity** - One version number for all SDKs
2. **Clear communication** - Easy to understand SDK compatibility
3. **Synchronized releases** - All languages evolve together
4. **No tag prefix confusion** - Standard semantic versioning

### Version Numbers Across Languages

When we release `v0.3.0`:
- Go SDK: `v0.3.0`
- Python SDK: `v0.3.0`
- Future SDKs: `v0.3.0`

Even if only Go changed, both get the same version. This is **intentional** and provides clear SDK-wide versioning.

### Release Process

1. **Make changes** to any SDK (Go, Python, etc.)

2. **Update changelogs** in `_changelog/YYYY-MM/`

3. **Commit changes:**
   ```bash
   git add .
   git commit -m "feat(go/workflow): add new feature"
   ```

4. **Create version tag:**
   ```bash
   git tag -a v0.X.Y -m "Release v0.X.Y - Description"
   ```

5. **Push to remote:**
   ```bash
   git push origin main
   git push origin v0.X.Y
   ```

6. **Wait 5-10 minutes** for Go proxy to index the new version

7. **Update consumers:**
   ```bash
   cd stigmer/client-apps/cli
   make cli-update-deps
   ```

### Checking Go Proxy Status

Verify the new version is indexed:

```bash
curl -s https://proxy.golang.org/github.com/leftbin/stigmer-sdk/@latest | jq .Version
```

Should return: `"v0.X.Y"`

### Version History

- **v0.2.0** - First unified versioning release (January 2026)
  - Migrated to root-level module
  - Workflow SDK support
  - Type-safe helpers
  
- **v0.1.5** - Last subdirectory-tagged release (deprecated)
- **v0.1.4** - Workflow SDK (deprecated tagging)
- **v0.1.2** - Last working pre-workflow release

### Migration from Old Tagging

**Before (subdirectory module):**
```
Module: github.com/leftbin/stigmer-sdk/go
Tags: go/v0.1.2, go/v0.1.4, go/v0.1.5
```

**After (unified versioning):**
```
Module: github.com/leftbin/stigmer-sdk
Tags: v0.2.0, v0.3.0, ...
```

**Consumers must update:**
- `go.mod`: Change `github.com/leftbin/stigmer-sdk/go` → `github.com/leftbin/stigmer-sdk`
- Import paths stay the same: `github.com/leftbin/stigmer-sdk/go/agent`

### Comparison with Industry

**AWS SDK** (Independent versioning):
- Each service is independently versioned
- Tags: `service/s3/v1.50.0`, `service/ec2/v1.20.0`
- Complex but allows independent evolution

**Pulumi** (Unified versioning):
- Single version for all languages
- Tags: `v3.207.0`
- Simple, clear, easy to communicate

**Our choice:** Unified versioning like Pulumi, because:
- Simpler developer experience
- Easier to communicate SDK state
- All languages evolve together anyway
- No meaningful benefit to independent versioning

### Troubleshooting

**Error: "module github.com/leftbin/stigmer-sdk@vX.Y.Z not found"**

Solution: Wait 5-10 minutes for Go proxy to index the new tag.

**Error: "does not contain package github.com/leftbin/stigmer-sdk/go/workflow"**

Solution: Update to v0.2.0 or later (workflow added in v0.2.0).

**Old imports not working:**

If you have:
```go
require github.com/leftbin/stigmer-sdk/go v0.1.2
```

Update to:
```go
require github.com/leftbin/stigmer-sdk v0.2.0
```

Import paths stay the same.

### References

- Go Modules: https://go.dev/ref/mod
- Semantic Versioning: https://semver.org/
- Go Module Proxy: https://proxy.golang.org/
