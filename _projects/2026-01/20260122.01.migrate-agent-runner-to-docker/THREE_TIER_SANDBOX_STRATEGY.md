# Three-Tier Sandbox Strategy (Like Cursor)

**Decision Date**: 2026-01-22  
**Status**: Recommended Approach

## Problem

Original plan was to ship a 1GB+ Docker image with all cloud CLIs (AWS, GCP, Azure, kubectl, helm, terraform) to all users. This is:
- ❌ Slow to download
- ❌ Wasteful (most users don't need all tools)
- ❌ High barrier to adoption
- ❌ Not how Cursor works

## Solution: Three-Tier Strategy

Follow **Cursor's approach**: Default to local execution, sandbox is optional.

---

## Tier 1: LOCAL MODE (Default - 90% of Users)

**How it works**: Run commands directly on user's machine

**What user gets:**
- ✅ Uses tools they already have installed (Python, Node, AWS CLI, etc.)
- ✅ Fast (no container overhead)
- ✅ Minimal download (just agent-runner ~200MB)
- ✅ Familiar environment

**Configuration:**
```bash
# This is the DEFAULT
stigmer server start

# Or explicitly
export STIGMER_EXECUTION_MODE=local
stigmer server start
```

**Pros:**
- Zero friction onboarding
- Uses familiar tools and configs
- Fast execution
- No additional downloads

**Cons:**
- Less isolated (but same as Cursor)
- Requires tools to be installed (but users usually have them)

**Good for:**
- Open-source users
- Development workflows
- Quick prototyping
- Most everyday use cases

---

## Tier 2: BASIC SANDBOX (Optional Isolation)

**How it works**: Lightweight Docker container with common tools only

**What's included** (~300MB):
```dockerfile
FROM python:3.11-slim

# Just the basics
RUN apt-get update && apt-get install -y \
    git curl jq bash \
    nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# Python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# NO cloud CLIs
# NO Kubernetes tools
# NO Terraform/Pulumi
```

**Configuration:**
```bash
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start

# On first run with sandbox mode:
# → Agent-runner checks if ghcr.io/stigmer/agent-sandbox-basic:latest exists
# → If not, pulls it (~300MB, one-time)
# → Or builds from Dockerfile.sandbox.basic if offline
```

**Pros:**
- Basic isolation
- Small download (~300MB)
- Clean environment for testing
- Good for CI/CD

**Cons:**
- Doesn't include cloud CLIs (by design)
- Slightly slower than local
- Container overhead

**Good for:**
- Users wanting isolation without bloat
- Testing in clean environment
- CI/CD pipelines
- Users without tools installed locally

**Registry Publishing:**
- ⚠️ Published to GHCR **ONLY on manual trigger** (not automatic)
- Most users won't need it (local mode is default)
- Available for those who want it

---

## Tier 3: FULL SANDBOX (Power Users / Enterprise)

**How it works**: Reference Dockerfile, users build themselves

**What's included** (~1-2GB):
- Everything from Planton's Dockerfile.dev-tools
- Python, Node, Go, Rust
- AWS CLI, gcloud, az
- kubectl, helm, k9s
- terraform, pulumi
- Docker, docker-compose
- And much more...

**Configuration:**
```bash
# 1. Build it yourself
cd backend/services/agent-runner/sandbox
docker build -f Dockerfile.sandbox.full -t my-custom-sandbox:latest .

# 2. Use locally
export STIGMER_SANDBOX_IMAGE=my-custom-sandbox:latest
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start

# 3. Or push to Daytona
docker tag my-custom-sandbox:latest ghcr.io/mycompany/sandbox:v1
docker push ghcr.io/mycompany/sandbox:v1
# Configure Daytona to use this image
```

**Pros:**
- Complete tool isolation
- Reproducible across team
- Perfect for Daytona
- Enterprise-ready

**Cons:**
- Large download (~1-2GB)
- Slower to build
- Overkill for most users

**Good for:**
- Enterprise teams
- Daytona workspaces
- Specific tool requirements
- Teams wanting full reproducibility

**Registry Publishing:**
- ❌ NOT published to GHCR (too large, specialized)
- Provided as reference Dockerfile only
- Users build and host themselves

---

## Comparison: Stigmer vs Cursor

| Aspect | Cursor | Stigmer (This Plan) |
|--------|--------|---------------------|
| **Default Mode** | Local execution | Local execution ✅ |
| **Sandbox Option** | Available, lightweight | Available, lightweight ✅ |
| **Heavy Image** | Not shipped | Not shipped ✅ |
| **User Choice** | Simple toggle | Simple toggle ✅ |
| **Download Size** | Minimal | Minimal (~200MB agent-runner) ✅ |
| **Onboarding** | Fast | Fast ✅ |

**Result**: Same UX philosophy as Cursor!

---

## Implementation Impact

### What Changes:

**BEFORE (Original Plan):**
- Build one heavy sandbox (~1GB) with all tools
- Publish to GHCR automatically
- Users download on first sandbox mode use
- High download burden

**AFTER (Three-Tier Strategy):**
- Default to local mode (no sandbox needed)
- Provide lightweight basic sandbox (~300MB, optional)
- Provide full sandbox as reference (build yourself)
- Low download burden

### File Structure:

```
backend/services/agent-runner/sandbox/
├── Dockerfile.sandbox.basic          # Lightweight (~300MB)
│   └── Python + Node + Git only
├── Dockerfile.sandbox.full           # Reference (~1-2GB)
│   └── All tools from Planton (build yourself)
├── requirements.txt                  # Python packages for basic
└── README.md                         # Explains three tiers
```

### GitHub Workflow:

```yaml
# .github/workflows/publish-sandbox.yml
# Only runs on MANUAL TRIGGER (workflow_dispatch)
# Does NOT run automatically on push
# Publishes basic sandbox only (optional)
```

### User Experience:

**95% of users:**
```bash
brew install stigmer
stigmer server start  # Done! Uses local tools.
```

**5% wanting isolation:**
```bash
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start  # Downloads basic sandbox (~300MB) on first run
```

**<1% power users:**
```bash
# Build your own
cd sandbox
docker build -f Dockerfile.sandbox.full -t my-sandbox .
export STIGMER_SANDBOX_IMAGE=my-sandbox
stigmer server start
```

---

## Benefits for Open Source

1. **Fast Onboarding**: No big downloads, just works
2. **Low Friction**: Uses what users already have
3. **Familiar UX**: Same as Cursor (users understand it)
4. **Flexible**: Options for those who need isolation
5. **Sustainable**: Don't ship heavy images to everyone

---

## Decision

✅ **Adopt Three-Tier Strategy**

**Rationale:**
- Matches Cursor's proven UX
- Lower barrier to adoption
- More sustainable for open source
- Still supports power users (Daytona, enterprise)
- Avoids shipping 1GB+ images to everyone

**Next Steps:**
- Update T02 plan to reflect three-tier strategy ✅
- Implement local-first execution (default)
- Create lightweight Dockerfile.sandbox.basic (optional)
- Provide Dockerfile.sandbox.full as reference (for power users)
- Document all three tiers clearly

---

*"Make the common case fast, the uncommon case possible."*
