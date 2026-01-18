# Migrate Graphton to Local

**Created:** 2026-01-19  
**Status:** ✅ Complete (Documented & Committed)  
**Tech Stack:** Python/Poetry  
**Components:** agent-runner service, backend/libs/python

## Overview

Move Graphton library from plantonhq/graphton repo into Stigmer locally to eliminate slow push/PR/pull cycle.

## Goal

Eliminate dependency on external graphton repo and enable faster iteration on agent framework.

## Problem

Currently, agent-runner depends on Graphton from the external `plantonhq/graphton` GitHub repo:

```toml
graphton = {git = "https://github.com/plantonhq/graphton.git", branch = "main"}
```

**Pain points:**
- Every change requires: commit → push → wait for GitHub → poetry update
- Slow iteration cycle (minutes instead of seconds)
- Cannot easily test changes before pushing
- Dependency on external repo availability

## Solution

Move Graphton source code into Stigmer monorepo:
- Copy source from `/Users/suresh/scm/github.com/plantonhq/graphton/src/graphton`
- Place in `backend/libs/python/graphton/`
- Update agent-runner to use local path dependency
- Keep name as `graphton` to minimize code changes

## Success Criteria

- ✅ Graphton source code in `backend/libs/python/graphton/`
- ✅ agent-runner imports from local graphton (not GitHub)
- ✅ All tests pass
- ✅ Agent execution works with local graphton
- ✅ Documentation updated

## Components Affected

- `backend/libs/python/graphton/` (new)
- `backend/services/agent-runner/`
  - `pyproject.toml`
  - Import statements
  - Documentation
