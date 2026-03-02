---
name: Post-Migration Pipeline Fixes
overview: "After the Docker-to-native agent-runner migration, the Makefile and CI pipeline (`release.cli.yaml`) were never updated. The CI pipeline has a release-blocking bug: the CLI binary ships without embedded agent-runner source, meaning `stigmer server` will fail for every end user. The Makefile's `release-local` target is entirely Docker-based and broken."
todos:
  - id: fix-ci-pipeline
    content: "Fix release.cli.yaml: remove Docker image job, add sync.sh + embed_agentrunner to all 3 platform builds, update release job needs, fix stale comments/changelog"
    status: completed
  - id: fix-makefile
    content: "Fix Makefile: rewrite release-local (remove Docker), remove AGENT_RUNNER_SENTINEL, clean up clean target, optionally add build-release target"
    status: completed
  - id: fix-docs
    content: "Update release-workflow.md: replace PyInstaller references, update build process and local testing instructions"
    status: completed
  - id: fix-sync-sh
    content: "Fix sync.sh graphton path: libs/python/graphton -> backend/libs/python/graphton"
    status: completed
isProject: false
---

# Post-Migration Makefile and CI Pipeline Fixes

## Findings

### Critical: CI Pipeline (`release.cli.yaml`) -- Release-Blocking Bug

The CLI release pipeline still builds the **Docker agent-runner image** and ships a CLI binary **without embedded agent-runner Python source**. This means every released binary will fail at `agentrunner.SourceFS() == nil` when the daemon tries to start agent-runner.

**Gap 1 -- Dead `build-agent-runner-image` job (lines 105-149)**
Builds and pushes `ghcr.io/stigmer/agent-runner` Docker image. Docker agent-runner no longer exists. This job wastes CI minutes and the image is never used.

**Gap 2 -- CLI binaries lack embedded agent-runner source (all 3 platform build jobs)**
The `go build` commands on all platforms do not:

- Run `[sync.sh](client-apps/cli/embedded/agentrunner/sync.sh)` to populate the `source/` directory
- Use `-tags embed_agentrunner` to activate `//go:embed`

Without this, the production binary has no access to the Python source (no repo tree, no embed). `agentrunner.IsAvailable()` returns false, and the daemon refuses to start agent-runner.

The correct production build sequence is:

```bash
make protos                             # generate Python proto stubs
cd client-apps/cli/embedded/agentrunner && ./sync.sh && cd -
cd client-apps/cli && go build -tags embed_agentrunner -ldflags="..." -o stigmer .
```

**Gap 3 -- `release` job depends on dead Docker job (line 314)**

```yaml
needs: [determine-version, build-agent-runner-image, build-darwin-arm64, ...]
```

`build-agent-runner-image` must be removed from this dependency list.

**Gap 4 -- Stale Docker references in comments and changelog**

- Build step names say "BusyBox pattern - no embedded agent-runner" (lines 174, 288)
- Comments say "Agent-runner Docker image will be pulled from ghcr.io" (lines 204, 244)
- Release changelog template lists "Requirements: Docker (for agent-runner)" and "Docker-based agent-runner architecture" (lines 397-403, 422-424)

### High: Makefile -- Broken `release-local` Target

**Gap 5 -- `release-local` is entirely Docker-based (lines 84-121)**
This target:

- Calls `docker image inspect stigmer-agent-runner:local`
- Runs `docker build`, `docker stop`, `docker rm`
- Uses `AGENT_RUNNER_SENTINEL` for Docker image cache invalidation

All of this is dead code. For local development, the correct flow is a simple `go build` (no embed tag needed -- dev mode auto-locates source from the repo tree via `[agentrunner_dev.go](client-apps/cli/embedded/agentrunner/agentrunner_dev.go)`).

**Gap 6 -- Dead `AGENT_RUNNER_SENTINEL` variable (line 14)**
Only used by the broken `release-local` target.

**Gap 7 -- `clean` references dead sentinel (line 170)**
`rm -f $(AGENT_RUNNER_SENTINEL)` removes a file that is never created.

### Low: Documentation (`release-workflow.md`)

**Gap 8 -- Stale build process description**
The workflow docs reference PyInstaller, embedding agent-runner in the CLI binary via PyInstaller, and standalone `agent-runner` binaries in release assets. The actual mechanism is now `sync.sh` + `//go:embed`. Stage 2 description (lines 103-110) and local testing instructions (lines 172-180) are wrong.

### Not Broken (confirmed still valid)

- `lint-and-typecheck-agent-runner` job: Python code still exists, linting is correct
- `setup`, `test`, `lint` Makefile targets: Poetry/pytest/ruff/mypy for agent-runner still valid
- `release.sandbox.yaml`: Sandbox is separate from agent-runner (sandboxed code execution via Docker is still a valid feature)
- `release.mcp-server.yaml` and `release.website.yaml`: Unrelated, clean
- `sandbox` / `sandbox-clean` Makefile targets: `backend/services/agent-runner/sandbox/` still exists

### Secondary Finding: `sync.sh` Path Bug

`[sync.sh` line 18](client-apps/cli/embedded/agentrunner/sync.sh) references `$REPO_ROOT/libs/python/graphton`, but the actual path in the repo is `backend/libs/python/graphton` (per the [Makefile lint target](Makefile) at line 74). The `if [ -d ]` guard means it silently skips copying graphton. This is a pre-existing bug, not introduced by our migration, but worth fixing while we are in the area.

---

## Proposed Changes

### 1. Fix CI Pipeline (`release.cli.yaml`)

- **Remove** the entire `build-agent-runner-image` job (lines 105-149)
- **Add** `sync.sh` + `-tags embed_agentrunner` to each platform build job. For each of the three platform jobs (`build-darwin-arm64`, `build-darwin-amd64`, `build-linux-amd64`), add these steps after `make protos`:

```yaml
- name: Sync agent-runner source for embedding
  run: |
    cd client-apps/cli/embedded/agentrunner
    chmod +x sync.sh
    ./sync.sh

- name: Build CLI
  env:
    VERSION: ${{ needs.determine-version.outputs.version }}
  run: |
    cd client-apps/cli
    go build -tags embed_agentrunner \
      -ldflags="-s -w -X .../embedded.buildVersion=$VERSION" \
      -o ../../bin/stigmer .
```

- **Update** `release` job `needs` to remove `build-agent-runner-image`
- **Update** stale comments and changelog template to remove Docker references

### 2. Fix Makefile

- **Remove** `AGENT_RUNNER_SENTINEL` variable
- **Rewrite** `release-local` target: simple dev-mode `go build` (no Docker, no embed needed -- source is auto-located from repo tree in dev mode)
- **Clean up** `clean` target (remove sentinel reference)
- **Consider** adding a `build-release` target that runs `sync.sh` + builds with `-tags embed_agentrunner` for local production-like testing

### 3. Update Documentation (`release-workflow.md`)

- Replace PyInstaller references with `sync.sh` + `//go:embed` description
- Update Stage 2 build process description
- Update local testing instructions
- Remove references to standalone agent-runner binaries

### 4. Fix `sync.sh` Path Bug

- Change `GRAPHTON="$REPO_ROOT/libs/python/graphton"` to `GRAPHTON="$REPO_ROOT/backend/libs/python/graphton"`

