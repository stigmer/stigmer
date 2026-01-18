# SDK Tagging Guide

## Critical: Subdirectory Module Tagging

The `stigmer-sdk` repository uses a **subdirectory module** pattern where the Go module lives in `go/` directory with module path `github.com/leftbin/stigmer-sdk/go`.

### Tag Format Requirements

For subdirectory modules, Go requires tags with the subdirectory prefix:

**✅ CORRECT:**
```bash
git tag go/v0.1.5
git push origin go/v0.1.5
```

**❌ WRONG:**
```bash
git tag v0.1.5  # This won't work for Go clients!
```

### Why This Matters

When you tag incorrectly:
- Go clients trying to `go get github.com/leftbin/stigmer-sdk/go@latest` will fail
- Error: `module github.com/leftbin/stigmer-sdk/go@latest found (vX.Y.Z), but does not contain package ...`
- The CLI's `make cli-update-deps` will fail to update the SDK

### Tagging Workflow

When releasing a new SDK version:

```bash
# 1. Tag with correct go/ prefix
git tag go/v0.1.X

# 2. Optionally tag without prefix for reference (but Go won't use this)
git tag v0.1.X

# 3. Push both tags
git push origin go/v0.1.X v0.1.X
```

### Verifying Tags

Check remote tags have the correct format:

```bash
git ls-remote --tags origin | grep go/
```

You should see tags like:
```
refs/tags/go/v0.1.2
refs/tags/go/v0.1.3
refs/tags/go/v0.1.5
```

### Go Proxy Indexing

After pushing a new tag:
- Go proxy (proxy.golang.org) takes 5-10 minutes to index new tags
- Until indexed, `go get` commands will fail with "unknown revision"
- You can check indexing status: https://proxy.golang.org/github.com/leftbin/stigmer-sdk/go/@latest

### Fixing Incorrect Tags

If you've already created tags without the `go/` prefix:

```bash
# Create the correct tag pointing to the same commit
git tag go/v0.1.X v0.1.X

# Push the corrected tag
git push origin go/v0.1.X
```

### SDK Release Checklist

1. Commit and push all changes
2. Create annotated tag with `go/` prefix: `git tag -a go/vX.Y.Z -m "Release vX.Y.Z"`
3. Optionally create reference tag: `git tag vX.Y.Z`
4. Push tags: `git push origin go/vX.Y.Z vX.Y.Z`
5. Wait 5-10 minutes for Go proxy to index
6. Test with `cd /tmp && go mod init test && go get github.com/leftbin/stigmer-sdk/go@vX.Y.Z`
7. Update CLI with `make cli-update-deps`

## Reference

- [Go Modules: Module Paths](https://go.dev/ref/mod#module-path)
- [Go Modules: Publishing Modules](https://go.dev/doc/modules/publishing)
