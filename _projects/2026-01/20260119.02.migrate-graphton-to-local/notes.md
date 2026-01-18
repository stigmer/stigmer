# Notes

## Decision Log

**2026-01-19:** Decided to keep name as `graphton` to minimize code changes  
**2026-01-19:** Chose `backend/libs/python/graphton/` as location (matches Go libs pattern)  
**2026-01-19:** Used `src/graphton/` package layout (Poetry convention)  
**2026-01-19:** Set `develop = true` for editable install (changes reflect immediately)

## Key Learnings

### Package Structure Matters
Poetry requires proper package structure. Initially tried flat layout but had to reorganize to:
```
backend/libs/python/graphton/
├── src/
│   └── graphton/  ← actual package here
├── pyproject.toml
└── README.md
```

With `packages = [{include = "graphton", from = "src"}]` in pyproject.toml.

### Local Path Dependencies Need pyproject.toml
Poetry requires ALL local path dependencies to have a `pyproject.toml`. Had to create one for `apis/stubs/python/stigmer/` to fix dependency resolution.

### Benefit: Instant Iteration
Before: commit → push → wait for GitHub → poetry update (minutes)  
After: edit files → changes reflect immediately (seconds)

This is a **massive productivity win** for agent framework development!

### Migration Was Smooth
No code changes needed in agent-runner - all imports stayed the same:
```python
from graphton import create_deep_agent  # Just works!
```

## Gotchas Encountered

1. **Double graphton path error**: Poetry looked for `graphton/graphton/` because of incorrect package structure
2. **Stigmer stubs missing pyproject.toml**: Had to create minimal one for dependency resolution
3. **Poetry `--no-update` flag**: Doesn't exist in this version, just use `poetry lock`
