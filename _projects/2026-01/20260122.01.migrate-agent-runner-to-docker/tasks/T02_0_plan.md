# Task 02: Add Sandbox Docker Image with Daytona Support

**Created**: 2026-01-22  
**Status**: Planning  
**Type**: Feature Development

## Objective

Migrate the Dockerfile.dev-tools from Planton's agent-fleet-worker to Stigmer's agent-runner as a reference for sandbox environments, add Daytona snapshot documentation, and implement local sandbox setup following Gemini's registry-based approach.

## Context

We need to:
1. Bring the comprehensive dev-tools Dockerfile from Planton to Stigmer
2. Document how to create and use Daytona snapshots
3. Implement local sandbox setup using the same Docker image
4. Follow Gemini's suggestion to use pre-built images from GitHub Container Registry
5. Update agent-runner code to support sandbox management

## Current State

**In Planton** (`agent-fleet-worker/`):
- ✅ `Dockerfile.dev-tools` - Comprehensive dev environment with all CLIs
- ✅ `docs/daytona_snapshot_setup.md` - Complete Daytona documentation

**In Stigmer** (`agent-runner/`):
- ✅ `Dockerfile` - Basic agent-runner image (just runtime)
- ✅ `docker-compose.yml` - Basic orchestration
- ❌ No sandbox image
- ❌ No Daytona documentation
- ❌ No sandbox management code

## What We're Building

### Important Distinction: Two Docker Images

**Image 1: agent-runner** (existing, already done in T01)
- The service that processes agent executions
- Built from `backend/services/agent-runner/Dockerfile`
- Published to `ghcr.io/stigmer/agent-runner:latest`
- **Used by**: stigmer CLI to run the agent-runner service

**Image 2: agent-sandbox** (NEW, this task)
- The sandbox environment for executing user commands
- Built from `backend/services/agent-runner/sandbox/Dockerfile.sandbox`
- Published to `ghcr.io/stigmer/agent-sandbox:latest`
- **Used by**: agent-runner service (when sandbox mode is enabled)

### 1. Sandbox Docker Images (NEW - Three Tiers)

**Strategy: Follow Cursor's approach - Local by default, sandbox optional**

#### **Dockerfile.sandbox.basic** (Optional, Lightweight ~200-300MB)
- Python 3.11 + pip
- Node.js + npm  
- Git, curl, jq, bash
- **NO** cloud CLIs (users install if needed)
- **For**: Basic isolation without bloat

#### **Dockerfile.sandbox.full** (Reference, Heavy ~1-2GB)
- Everything from Planton's Dockerfile.dev-tools
- All cloud CLIs (AWS, GCP, Azure, kubectl, helm, terraform)
- **For**: Daytona, enterprise users, power users
- **NOT** published to GHCR (users build themselves)

**This is used BY agent-runner, not instead of it**

**Key Decision: Default to LOCAL mode (no sandbox) like Cursor**

### 2. Daytona Integration

**Documentation** (`docs/sandbox/daytona-setup.md`):
- How to build the sandbox image
- How to push to Daytona
- How to create a snapshot ID
- How to use snapshots in workflows

### 3. Local Sandbox Setup

**Documentation** (`docs/sandbox/local-setup.md`):
- How to use the sandbox image locally
- Docker Compose configuration
- Volume mounting strategies
- Network configuration

### 4. GitHub Container Registry Integration

Following Gemini's "Golden Image" approach:

**CI/CD** (`.github/workflows/publish-sandbox.yml`):
- Build sandbox image on changes
- Push to `ghcr.io/stigmer/agent-sandbox:latest`
- Tag with commit SHA for versioning

**CLI Integration** (agent-runner code):
- Auto-pull sandbox image if not present
- Support custom requirements.txt (layered approach)
- Fallback to local build if needed

### 5. Sandbox Management Code (Dual-Mode Support)

**Updated module** (`worker/sandbox_manager.py`):

**Execution Modes** (like Cursor):
1. **Local Mode** (default): Execute directly on host machine
2. **Sandbox Mode**: Execute in isolated Docker container

**Functions:**
- `execute_command()` - Smart dispatcher (local or sandbox based on config)
- `execute_local()` - Run commands directly on host
- `execute_in_sandbox()` - Run commands in Docker container
- `ensure_sandbox_image()` - Download or build sandbox image (only for sandbox mode)
- `create_sandbox_container()` - Spin up sandbox from image (only for sandbox mode)
- `cleanup_sandbox()` - Remove sandbox containers (only for sandbox mode)

**Configuration** (`worker/config.py`):
```python
class ExecutionMode(Enum):
    LOCAL = "local"      # Run on host machine
    SANDBOX = "sandbox"  # Run in Docker container
    AUTO = "auto"        # Auto-detect based on requirements

# Default mode
DEFAULT_EXECUTION_MODE = ExecutionMode.LOCAL
```

## Implementation Phases

### Phase 1: Create Three-Tier Sandbox Strategy (30 min)

**Files to create:**
- `backend/services/agent-runner/sandbox/Dockerfile.sandbox.basic` (lightweight, ~300MB)
- `backend/services/agent-runner/sandbox/Dockerfile.sandbox.full` (reference only, from Planton)
- `backend/services/agent-runner/sandbox/requirements.txt` (basic Python packages)
- `backend/services/agent-runner/docs/sandbox/README.md` (explain three tiers)
- `backend/services/agent-runner/docs/sandbox/execution-modes.md` (local vs sandbox)
- `backend/services/agent-runner/docs/sandbox/daytona-setup.md` (for power users)

**Actions:**
1. Create **lightweight** Dockerfile.sandbox.basic (Python + Node + Git only)
2. Copy Planton's Dockerfile.dev-tools as Dockerfile.sandbox.full (reference)
3. Document three-tier strategy (local, basic sandbox, custom sandbox)
4. Migrate Daytona documentation (for Dockerfile.sandbox.full users)

### Phase 2: GitHub Container Registry Setup - OPTIONAL Only (20 min)

**Decision: DON'T publish sandbox to GHCR by default**

**Files to create:**
- `.github/workflows/publish-sandbox.yml` (DISABLED by default, manual trigger only)
- `backend/services/agent-runner/sandbox/docker-compose.sandbox.yml`

**Actions:**
1. Create GitHub workflow for **basic** sandbox image (lightweight)
2. Set to `workflow_dispatch` only (manual trigger, not automatic)
3. Document that sandbox is OPTIONAL (local mode is default)
4. Add multi-arch build support (amd64, arm64) for when triggered

**Why manual only:**
- Most users don't need sandbox (local mode is default)
- Avoid bloating releases with images most users won't use
- Power users can build Dockerfile.sandbox.full themselves

### Phase 3: Dual-Mode Execution Implementation (60 min)

**Files to modify:**
- `backend/services/agent-runner/worker/sandbox_manager.py`
- `backend/services/agent-runner/worker/config.py`
- `backend/services/agent-runner/grpc_client/agent_execution_client.py` (optional: pass mode)

**New features:**

1. **Execution Mode Configuration:**
   ```python
   # config.py
   class ExecutionMode(Enum):
       LOCAL = "local"      # Execute on host (default, fast)
       SANDBOX = "sandbox"  # Execute in Docker (isolated)
       AUTO = "auto"        # Auto-detect based on complexity
   
   # Environment variable or config file
   EXECUTION_MODE = os.getenv("STIGMER_EXECUTION_MODE", "local")
   ```

2. **Smart Command Dispatcher:**
   ```python
   async def execute_command(
       command: str, 
       mode: ExecutionMode = ExecutionMode.LOCAL,
       requirements: Optional[Path] = None
   ) -> ExecutionResult:
       """
       Execute command based on mode
       
       Modes:
       - LOCAL: subprocess.run() on host machine
       - SANDBOX: docker exec in container
       - AUTO: detect based on command complexity
       """
       if mode == ExecutionMode.AUTO:
           mode = detect_execution_mode(command, requirements)
       
       if mode == ExecutionMode.LOCAL:
           return await execute_local(command)
       else:
           return await execute_in_sandbox(command, requirements)
   ```

3. **Local Execution (Default):**
   ```python
   async def execute_local(command: str) -> ExecutionResult:
       """Execute command directly on host machine"""
       # Simple subprocess execution
       # Stream output in real-time
       # Return exit code and output
       # Fast, no Docker overhead
   ```

4. **Sandbox Execution (Isolated):**
   ```python
   async def execute_in_sandbox(
       command: str,
       requirements: Optional[Path] = None
   ) -> ExecutionResult:
       """Execute command in isolated Docker container"""
       # Ensure sandbox image available
       await ensure_sandbox_image()
       
       # Create container (with custom layer if requirements provided)
       container_id = await create_sandbox_container(requirements)
       
       # Execute command
       result = await docker_exec(container_id, command)
       
       # Cleanup
       await cleanup_container(container_id)
       
       return result
   ```

5. **Auto-Detection Logic:**
   ```python
   def detect_execution_mode(
       command: str, 
       requirements: Optional[Path] = None
   ) -> ExecutionMode:
       """
       Auto-detect if sandboxing is needed
       
       Use SANDBOX if:
       - Custom requirements.txt provided
       - Command uses pip/npm/package managers
       - Command modifies system state
       
       Use LOCAL if:
       - Simple shell commands (echo, ls, cd)
       - Read-only operations
       - Standard utilities available
       """
       if requirements:
           return ExecutionMode.SANDBOX
       
       # Check if command needs isolation
       risky_commands = ['pip', 'npm', 'apt', 'yum', 'brew']
       if any(cmd in command for cmd in risky_commands):
           return ExecutionMode.SANDBOX
       
       return ExecutionMode.LOCAL
   ```

6. **Image Management (Only for Sandbox Mode):**
   ```python
   SANDBOX_IMAGE = "ghcr.io/stigmer/agent-sandbox:latest"
   
   async def ensure_sandbox_image():
       """Pull sandbox image from registry or build locally"""
       # Check if image exists locally
       # If not, try to pull from GHCR
       # If pull fails, build from Dockerfile.sandbox
   ```

7. **Container Creation (Only for Sandbox Mode):**
   ```python
   async def create_sandbox_container(
       execution_id: str, 
       requirements: Optional[Path] = None
   ):
       """Create sandbox container, optionally with custom requirements"""
       # If requirements.txt provided, build custom layer
       # Otherwise use base image
       # Mount workspace volumes
       # Configure networking
   ```

### Phase 4: Makefile and CLI Integration (20 min)

**Files to modify:**
- `Makefile`
- `backend/services/agent-runner/main.py` (optional: add CLI flags)

**New Makefile targets:**
```makefile
.PHONY: sandbox-build
sandbox-build:
	cd backend/services/agent-runner/sandbox && docker build -t stigmer/agent-sandbox:latest -f Dockerfile.sandbox .

.PHONY: sandbox-push
sandbox-push: sandbox-build
	docker tag stigmer/agent-sandbox:latest ghcr.io/stigmer/agent-sandbox:latest
	docker push ghcr.io/stigmer/agent-sandbox:latest

.PHONY: sandbox-test
sandbox-test: sandbox-build
	docker run --rm stigmer/agent-sandbox:latest python --version
	docker run --rm stigmer/agent-sandbox:latest aws --version

.PHONY: test-local-mode
test-local-mode:
	STIGMER_EXECUTION_MODE=local poetry run python -m backend.services.agent-runner.main

.PHONY: test-sandbox-mode
test-sandbox-mode:
	STIGMER_EXECUTION_MODE=sandbox poetry run python -m backend.services.agent-runner.main
```

**Optional CLI enhancement:**
```python
# main.py - Add command-line flag
parser.add_argument(
    '--execution-mode',
    choices=['local', 'sandbox', 'auto'],
    default='local',
    help='Execution mode: local (default, fast) | sandbox (isolated) | auto (detect)'
)
```

### Phase 5: Documentation and Testing (30 min)

**Files to create/update:**
- `SANDBOX_IMPLEMENTATION_SUMMARY.md`
- Update `next-task.md`
- Create checkpoint

**Testing checklist:**

**Local Mode (Default):**
- [ ] Simple commands execute on host (echo, ls, pwd)
- [ ] Python scripts run with host Python
- [ ] No Docker overhead for simple operations
- [ ] Fast execution (<100ms for simple commands)

**Sandbox Mode (Isolated):**
- [ ] Sandbox Dockerfile builds successfully
- [ ] Image pushed to GHCR
- [ ] CLI can pull image from registry
- [ ] Container starts with proper environment
- [ ] Commands execute successfully in sandbox
- [ ] Custom requirements.txt works (layered approach)
- [ ] Cleanup removes containers properly

**Auto Mode (Smart Detection):**
- [ ] Simple commands → local mode
- [ ] pip/npm commands → sandbox mode
- [ ] Custom requirements.txt → sandbox mode
- [ ] System modifications → sandbox mode

**Mode Switching:**
- [ ] Environment variable changes mode (STIGMER_EXECUTION_MODE)
- [ ] CLI flag changes mode (--execution-mode)
- [ ] Config file persists user preference
- [ ] Mode selection clearly communicated to user

## Success Criteria

### Dual-Mode Execution
1. ✅ **Local mode works** - Commands execute directly on host (default, fast)
2. ✅ **Sandbox mode works** - Commands execute in Docker container (isolated)
3. ✅ **Auto mode works** - Automatically detects when sandboxing is needed
4. ✅ **Mode switching** - Users can change execution mode via config/CLI flag

### Sandbox Infrastructure
5. ✅ Dockerfile.sandbox builds successfully with all tools
6. ✅ GitHub workflow builds and pushes to GHCR
7. ✅ CLI auto-pulls sandbox image on demand (only when sandbox mode used)
8. ✅ Custom requirements.txt support works (layered approach)
9. ✅ Cleanup removes sandbox containers properly

### Documentation
10. ✅ Execution modes documented (like Cursor's UX)
11. ✅ Daytona documentation is complete and accurate
12. ✅ Local sandbox setup works with docker-compose
13. ✅ Users understand when to use each mode

## Risks and Mitigations

**Risk 1: Image Size** ✅ RESOLVED
- ~~Sandbox image will be large (~500MB-1GB) with all tools~~
- **Solution**: Default to LOCAL mode (no sandbox needed, like Cursor)
- **Optional**: Lightweight basic sandbox (~300MB) for isolation
- **Power users**: Build full sandbox themselves (Dockerfile.sandbox.full reference provided)
- **Result**: 90% of users never download sandbox image

**Risk 2: Registry Access** ✅ MITIGATED
- ~~GHCR might have rate limits or authentication issues~~
- **Solution**: Sandbox images not required for default workflow
- **Fallback**: Local build from Dockerfile if user wants sandbox
- **Result**: No dependency on GHCR for most users

**Risk 3: Network Configuration**
- Sandbox containers need to access external APIs and local services
- **Mitigation**: Use host networking for dev, bridge networking for prod, document configurations

**Risk 4: Volume Mounting**
- Need to mount workspace and logs correctly across platforms
- **Mitigation**: Use Docker Compose for consistent mounting, test on macOS/Linux/Windows

## Dependencies

**External:**
- Docker installed and running
- GitHub Container Registry access
- Internet connection for pulling images

**Internal:**
- agent-runner Docker migration complete (Task T01) ✅
- Basic Docker infrastructure in place ✅

## Related Files to Reference

**From Planton:**
- `backend/services/agent-fleet-worker/Dockerfile.dev-tools`
- `backend/services/agent-fleet-worker/docs/daytona_snapshot_setup.md`

**From Gemini:**
- `_cursor/gemini-response.md` - Registry approach, layered builds

**In Stigmer:**
- `backend/services/agent-runner/Dockerfile` - Current agent-runner image
- `backend/services/agent-runner/worker/sandbox_manager.py` - Current sandbox code
- `backend/services/agent-runner/docker-compose.yml` - Current orchestration

## Next Steps

1. Review this plan with developer
2. Get approval to proceed
3. Create T02_1_review.md with feedback
4. Create T02_2_revised_plan.md if needed
5. Create T02_3_execution.md and begin implementation

## Estimated Time

**Total**: ~2.5 hours (simplified - local mode focus)
- Phase 1: 30 min (create three-tier Dockerfiles + docs)
- Phase 2: 20 min (optional CI/CD setup)
- Phase 3: 50 min (dual-mode execution implementation, local-first)
- Phase 4: 20 min (Makefile + CLI integration)
- Phase 5: 30 min (docs and testing)

## Implementation Strategy

We'll combine **Cursor's UX flexibility** with **Gemini's "Golden Image" approach**:

### Cursor's Dual-Mode UX
1. **Local Mode (Default)**: Execute directly on host machine
   - ✅ Fast (no Docker overhead)
   - ✅ Uses user's existing environment
   - ✅ Perfect for simple commands
   
2. **Sandbox Mode (Isolated)**: Execute in Docker container
   - ✅ Isolated environment
   - ✅ Reproducible builds
   - ✅ Custom dependencies supported
   
3. **Auto Mode (Smart)**: Automatically choose based on command
   - ✅ Balances speed and safety
   - ✅ Transparent to user
   - ✅ Learns from patterns

### Gemini's Golden Image Approach (for Sandbox Mode)
1. **Base Image**: Comprehensive sandbox with all tools (pre-built)
2. **Registry**: Push to GHCR for fast distribution
3. **Auto-Pull**: CLI automatically downloads image on first use (only when needed)
4. **Layered Builds**: Support custom requirements.txt for power users
5. **Fallback**: Local build if registry unavailable

### Combined Benefits
- ✅ **Fast by default** (local mode, no Docker)
- ✅ **Isolated when needed** (sandbox mode with pre-built image)
- ✅ **Smart detection** (auto mode chooses best option)
- ✅ **User control** (can override mode anytime)
- ✅ **No forced dependencies** (Docker only needed for sandbox mode)
- ✅ **Consistent UX** (like Cursor, users understand it immediately)

## File Structure After Implementation

```
backend/services/agent-runner/
├── Dockerfile                          # Runtime agent-runner (existing)
├── docker-compose.yml                  # Agent-runner orchestration (existing)
├── sandbox/
│   ├── Dockerfile.sandbox             # NEW: Comprehensive dev tools image
│   ├── requirements.txt               # NEW: Python packages for sandbox
│   ├── docker-compose.sandbox.yml     # NEW: Local sandbox orchestration
│   └── README.md                      # NEW: Sandbox overview
├── docs/
│   ├── sandbox/
│   │   ├── README.md                  # NEW: Sandbox documentation hub
│   │   ├── execution-modes.md        # NEW: Local vs Sandbox vs Auto (like Cursor)
│   │   ├── daytona-setup.md          # NEW: Daytona snapshot guide
│   │   ├── local-setup.md            # NEW: Local sandbox guide
│   │   └── registry-setup.md         # NEW: GHCR setup guide
│   └── ... (existing docs)
├── worker/
│   ├── sandbox_manager.py             # MODIFIED: Add registry pull, layered builds
│   └── ... (existing workers)
└── ...

.github/workflows/
├── release-embedded.yml                # Existing agent-runner workflow
└── publish-sandbox.yml                 # NEW: Sandbox image CI/CD
```

## Development Workflow vs Production Distribution

### 1. Local Development (Makefile)

**Current state** (agent-runner):
```makefile
release-local-full:  # Builds CLI + agent-runner Docker image locally
    make protos
    make build  # Builds stigmer CLI
    cd backend/services/agent-runner && docker build -t stigmer-agent-runner:local
```

**NEW additions** (agent-sandbox):
```makefile
# Build sandbox image locally for development
.PHONY: sandbox-build-local
sandbox-build-local:
	@echo "Building agent-sandbox image locally..."
	cd backend/services/agent-runner/sandbox && \
		docker build -f Dockerfile.sandbox -t stigmer/agent-sandbox:local .
	@echo "✓ Built: stigmer/agent-sandbox:local"

# Full local dev setup (CLI + agent-runner + agent-sandbox)
.PHONY: dev-full
dev-full: protos build release-local-full sandbox-build-local
	@echo "============================================"
	@echo "✓ Full dev environment ready!"
	@echo "  - CLI: bin/stigmer"
	@echo "  - Agent-runner: stigmer-agent-runner:local"
	@echo "  - Agent-sandbox: stigmer/agent-sandbox:local"
	@echo "============================================"
	@echo ""
	@echo "Testing with local mode (no sandbox needed):"
	@echo "  stigmer server start"
	@echo ""
	@echo "Testing with sandbox mode (uses local image):"
	@echo "  STIGMER_EXECUTION_MODE=sandbox stigmer server start"
```

**Developer workflow:**
1. Make changes to agent-runner code
2. Run `make dev-full` (rebuilds everything locally)
3. Test with `stigmer server start` (uses local Docker images)
4. No need to push to registry during development

**Optimization:**
- Local mode doesn't require sandbox image (fast iteration)
- Sandbox image only built when testing sandbox mode
- Both images tagged with `:local` to avoid conflicts with registry

### 2. CI/CD Pipeline (GitHub Actions)

**Current workflow** (`.github/workflows/release-embedded.yml`):
- ✅ Builds **agent-runner** image
- ✅ Pushes to `ghcr.io/stigmer/agent-runner:latest`
- ✅ Builds CLI binaries (darwin-arm64, darwin-amd64, linux-amd64)
- ✅ Packages and releases

**NEW workflow** (`.github/workflows/publish-sandbox.yml`):

```yaml
name: Publish Agent Sandbox Image

on:
  push:
    branches: [main]
    paths:
      - 'backend/services/agent-runner/sandbox/**'
      - '.github/workflows/publish-sandbox.yml'
  workflow_dispatch:  # Manual trigger

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Determine version
        id: version
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            VERSION="v$(date +%Y%m%d-%H%M%S)"
          else
            VERSION="$(git rev-parse --short HEAD)"
          fi
          echo "version=$VERSION" >> $GITHUB_OUTPUT

      - name: Build and push sandbox image
        run: |
          cd backend/services/agent-runner/sandbox
          
          docker buildx build \
            --platform linux/amd64,linux/arm64 \
            --file Dockerfile.sandbox \
            --tag ghcr.io/stigmer/agent-sandbox:${{ steps.version.outputs.version }} \
            --tag ghcr.io/stigmer/agent-sandbox:latest \
            --push \
            .
          
          echo "✓ Sandbox image published:"
          echo "  - ghcr.io/stigmer/agent-sandbox:${{ steps.version.outputs.version }}"
          echo "  - ghcr.io/stigmer/agent-sandbox:latest"
```

**Key points:**
- Separate workflow from CLI/agent-runner (different change frequency)
- Only triggers when sandbox files change
- Builds multi-arch (amd64, arm64)
- Tags with both version and `latest`

### 3. User Installation Experience

**Scenario 1: User installs Stigmer (first time)**

```bash
# User installs CLI
brew install stigmer

# User starts server (first time)
stigmer server start

# What happens:
# 1. CLI starts (Go binary, already installed)
# 2. CLI checks if agent-runner image exists locally
# 3. If not, CLI pulls: ghcr.io/stigmer/agent-runner:latest
# 4. CLI starts agent-runner container
# 5. Agent-runner starts in LOCAL mode (default)
#    - No sandbox image needed yet!
#    - Executes commands directly on host
```

**Scenario 2: User needs sandbox mode**

```bash
# User wants isolated execution
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start

# What happens:
# 1. CLI starts agent-runner container (as before)
# 2. Agent-runner detects sandbox mode
# 3. Agent-runner checks if sandbox image exists locally
# 4. If not, agent-runner pulls: ghcr.io/stigmer/agent-sandbox:latest
# 5. Agent-runner creates sandbox container
# 6. Commands execute in sandbox
```

**Scenario 3: Daytona user (power user)**

```bash
# User wants to use Daytona workspace
# Follow docs/sandbox/daytona-setup.md:
# 1. Build sandbox image
# 2. Push to Daytona
# 3. Get snapshot ID
# 4. Configure agent-runner to use Daytona snapshot
```

### Image Pull Logic

**CLI pulls agent-runner** (`client-apps/cli/internal/cli/daemon/daemon.go`):
```go
// Already implemented in T01
func ensureAgentRunnerImage() error {
    image := "ghcr.io/stigmer/agent-runner:latest"
    
    // Check if exists locally
    if imageExists(image) {
        return nil
    }
    
    // Pull from registry
    return docker.ImagePull(image)
}
```

**Agent-runner pulls sandbox** (`backend/services/agent-runner/worker/sandbox_manager.py`):
```python
# NEW implementation in this task
SANDBOX_IMAGE = "ghcr.io/stigmer/agent-sandbox:latest"

async def ensure_sandbox_image():
    """Only called when sandbox mode is used"""
    # Check if exists locally
    try:
        client.images.get(SANDBOX_IMAGE)
        return  # Already have it
    except docker.errors.ImageNotFound:
        pass
    
    # Try to pull from registry
    try:
        logger.info(f"Pulling sandbox image: {SANDBOX_IMAGE}")
        client.images.pull(SANDBOX_IMAGE)
        logger.info("✓ Sandbox image ready")
    except Exception as e:
        # Fallback: build locally if Dockerfile.sandbox exists
        logger.warning(f"Failed to pull {SANDBOX_IMAGE}: {e}")
        logger.info("Attempting local build...")
        build_sandbox_locally()
```

### Summary: Two Images, Two Pull Points

| Image | Pulled By | When | Size | Shipped? |
|-------|-----------|------|------|----------|
| **agent-runner** | stigmer CLI | On `stigmer server start` | ~200MB | ✅ Yes (GHCR) |
| **agent-sandbox-basic** | agent-runner | When sandbox mode used | ~300MB | ⚠️ Manual only |
| **agent-sandbox-full** | N/A | User builds themselves | ~1-2GB | ❌ Reference only |

**User experience (Like Cursor):**
- **Default path** (local mode): Just agent-runner (~200MB) + uses your installed tools
- **Optional isolation** (basic sandbox): agent-runner + basic sandbox (~500MB total)
- **Power user path** (full sandbox): Build Dockerfile.sandbox.full yourself (~2GB)
- **Developer path** (local dev): Build locally with `make dev-full`

### Configuration Flow

**Development** (`Makefile`):
```bash
make dev-full  # Builds everything locally
# Creates:
# - bin/stigmer
# - stigmer-agent-runner:local
# - stigmer/agent-sandbox:local
```

**CI/CD** (GitHub Actions):
```bash
# release-embedded.yml (existing)
→ Builds agent-runner → Pushes to ghcr.io/stigmer/agent-runner:latest

# publish-sandbox.yml (NEW)
→ Builds agent-sandbox → Pushes to ghcr.io/stigmer/agent-sandbox:latest
```

**Production** (User):
```bash
stigmer server start  # CLI pulls agent-runner
# If local mode: No additional pulls
# If sandbox mode: Agent-runner pulls agent-sandbox
```

## Alignment with Project Goals

This task directly supports the project's success criteria:
- ✅ Extends Docker migration with sandbox support
- ✅ Documents Daytona integration (from Planton experience)
- ✅ Implements registry-based distribution (Gemini's recommendation)
- ✅ Provides local sandbox setup (development parity)
- ✅ Enables future agent execution in isolated environments
- ✅ **Clear separation: dev workflow (Makefile) vs production (CI/CD)**
- ✅ **Minimal user friction: Docker only when needed**

---

**Ready for review!** Please provide feedback or approve to proceed with execution.
