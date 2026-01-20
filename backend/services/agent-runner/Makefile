# Agent Runner Makefile
# Provides Docker build and management targets for local development and CI/CD

# Configuration
REPO_ROOT := $(shell git rev-parse --show-toplevel)
IMAGE_REPO := ghcr.io/stigmer/agent-runner
VERSION ?= dev-local
CONTAINER_NAME := stigmer-agent-runner

# Multi-arch build platforms
PLATFORMS := linux/amd64,linux/arm64

# Container runtime detection (Docker or Podman)
CONTAINER_RUNTIME := $(shell command -v docker 2>/dev/null || command -v podman 2>/dev/null)

.PHONY: help
help:
	@echo "Agent Runner - Docker Build Targets"
	@echo ""
	@echo "Configuration:"
	@echo "  IMAGE_REPO         = $(IMAGE_REPO)"
	@echo "  VERSION            = $(VERSION) (override with VERSION=x.y.z)"
	@echo "  CONTAINER_NAME     = $(CONTAINER_NAME)"
	@echo "  CONTAINER_RUNTIME  = $(CONTAINER_RUNTIME)"
	@echo ""
	@echo "Development Workflow:"
	@echo "  make build                  Run type checking and linting"
	@echo "  make build-image            Build Docker image (single arch)"
	@echo "  make run-local              Run container locally for testing"
	@echo "  make test-image             Test image health check"
	@echo "  make logs                   View container logs"
	@echo "  make stop                   Stop and remove container"
	@echo ""
	@echo "Publishing Workflow:"
	@echo "  make docker-login           Authenticate to ghcr.io"
	@echo "  make push-image             Build and push image (single arch)"
	@echo "  make build-multiarch        Build multi-arch images"
	@echo "  make push-multiarch         Build and push multi-arch images"
	@echo ""
	@echo "Examples:"
	@echo "  make build-image VERSION=1.2.3"
	@echo "  make run-local"
	@echo "  make push-image VERSION=1.2.3"
	@echo ""

# ---------- Type Checking ----------
.PHONY: build
build:
	@echo "🔍 Running type checking and linting..."
	cd $(REPO_ROOT)/backend/services/agent-runner && \
		poetry install --no-interaction && \
		poetry run mypy grpc_client/ worker/ --show-error-codes
	@echo "✅ Type checking passed"

# ---------- Local Development ----------
.PHONY: build-image
build-image: build
	@echo "🐳 Building Docker image..."
	@echo "   Repository: $(IMAGE_REPO)"
	@echo "   Version: $(VERSION)"
	@echo "   Platform: linux/amd64"
	$(CONTAINER_RUNTIME) build \
		--platform linux/amd64 \
		-f $(REPO_ROOT)/backend/services/agent-runner/Dockerfile \
		-t $(IMAGE_REPO):$(VERSION) \
		-t $(IMAGE_REPO):latest \
		$(REPO_ROOT)
	@echo "✅ Built: $(IMAGE_REPO):$(VERSION)"
	@echo "✅ Tagged: $(IMAGE_REPO):latest"

.PHONY: run-local
run-local:
	@echo "🚀 Starting agent-runner container..."
	@echo "   Image: $(IMAGE_REPO):$(VERSION)"
	@echo "   Container: $(CONTAINER_NAME)"
	@echo ""
	@echo "⚠️  Make sure these services are running:"
	@echo "   - Temporal server (localhost:7233)"
	@echo "   - stigmer-server (localhost:7234)"
	@echo ""
	@echo "📝 Required environment variables:"
	@echo "   Set these in your shell before running:"
	@echo "   - STIGMER_LLM_PROVIDER"
	@echo "   - STIGMER_LLM_MODEL"
	@echo "   - STIGMER_LLM_API_KEY (if applicable)"
	@echo ""
	@# Stop existing container if running
	@$(CONTAINER_RUNTIME) rm -f $(CONTAINER_NAME) 2>/dev/null || true
	@# Run container with host networking and volume mount
	$(CONTAINER_RUNTIME) run -d \
		--name $(CONTAINER_NAME) \
		--network host \
		-v $(HOME)/.stigmer/data/workspace:/workspace \
		-e MODE=local \
		-e SANDBOX_TYPE=filesystem \
		-e SANDBOX_ROOT_DIR=/workspace \
		-e TEMPORAL_SERVICE_ADDRESS=localhost:7233 \
		-e STIGMER_BACKEND_ENDPOINT=localhost:7234 \
		-e STIGMER_LLM_PROVIDER=$${STIGMER_LLM_PROVIDER:-openai} \
		-e STIGMER_LLM_MODEL=$${STIGMER_LLM_MODEL:-gpt-4} \
		-e OPENAI_API_KEY=$${OPENAI_API_KEY:-} \
		-e LOG_LEVEL=$${LOG_LEVEL:-INFO} \
		$(IMAGE_REPO):$(VERSION)
	@echo "✅ Container started: $(CONTAINER_NAME)"
	@echo ""
	@echo "View logs: make logs"
	@echo "Stop container: make stop"

.PHONY: test-image
test-image:
	@echo "🧪 Testing image health check..."
	@echo "   Image: $(IMAGE_REPO):$(VERSION)"
	@# Create temporary container
	@$(CONTAINER_RUNTIME) run --rm --name $(CONTAINER_NAME)-test \
		-e TEMPORAL_SERVICE_ADDRESS=localhost:7233 \
		-e STIGMER_BACKEND_ENDPOINT=localhost:7234 \
		$(IMAGE_REPO):$(VERSION) \
		/app/.venv/bin/python -c "from worker.config import Config; print('✅ Image health check passed')"

.PHONY: logs
logs:
	@echo "📋 Viewing logs for $(CONTAINER_NAME)..."
	$(CONTAINER_RUNTIME) logs -f $(CONTAINER_NAME)

.PHONY: stop
stop:
	@echo "🛑 Stopping and removing container..."
	@$(CONTAINER_RUNTIME) stop $(CONTAINER_NAME) 2>/dev/null || true
	@$(CONTAINER_RUNTIME) rm $(CONTAINER_NAME) 2>/dev/null || true
	@echo "✅ Container stopped and removed"

# ---------- Publishing ----------
.PHONY: docker-login
docker-login:
	@echo "🔐 Authenticating to GitHub Container Registry..."
	@echo ""
	@echo "You need a GitHub Personal Access Token with 'write:packages' scope."
	@echo "Create one at: https://github.com/settings/tokens/new"
	@echo ""
	@read -p "GitHub Username: " username; \
	echo ""; \
	echo "Paste your token:"; \
	$(CONTAINER_RUNTIME) login ghcr.io -u $$username
	@echo "✅ Authenticated to ghcr.io"

.PHONY: push-image
push-image: build-image
	@echo "📤 Pushing image to registry..."
	@echo "   Repository: $(IMAGE_REPO)"
	@echo "   Version: $(VERSION)"
	$(CONTAINER_RUNTIME) push $(IMAGE_REPO):$(VERSION)
	@echo "✅ Pushed: $(IMAGE_REPO):$(VERSION)"

.PHONY: build-multiarch
build-multiarch: build
	@echo "🐳 Building multi-arch Docker images..."
	@echo "   Repository: $(IMAGE_REPO)"
	@echo "   Version: $(VERSION)"
	@echo "   Platforms: $(PLATFORMS)"
	docker buildx build \
		--platform $(PLATFORMS) \
		-f $(REPO_ROOT)/backend/services/agent-runner/Dockerfile \
		-t $(IMAGE_REPO):$(VERSION) \
		-t $(IMAGE_REPO):latest \
		$(REPO_ROOT)
	@echo "✅ Built multi-arch images: $(IMAGE_REPO):$(VERSION)"

.PHONY: push-multiarch
push-multiarch: build
	@echo "📤 Building and pushing multi-arch images..."
	@echo "   Repository: $(IMAGE_REPO)"
	@echo "   Version: $(VERSION)"
	@echo "   Platforms: $(PLATFORMS)"
	docker buildx build \
		--platform $(PLATFORMS) \
		--push \
		-f $(REPO_ROOT)/backend/services/agent-runner/Dockerfile \
		-t $(IMAGE_REPO):$(VERSION) \
		-t $(IMAGE_REPO):latest \
		$(REPO_ROOT)
	@echo "✅ Pushed multi-arch images: $(IMAGE_REPO):$(VERSION)"

# ---------- Cleanup ----------
.PHONY: clean
clean: stop
	@echo "🧹 Cleaning up Docker images..."
	@$(CONTAINER_RUNTIME) rmi $(IMAGE_REPO):$(VERSION) 2>/dev/null || true
	@$(CONTAINER_RUNTIME) rmi $(IMAGE_REPO):latest 2>/dev/null || true
	@echo "✅ Cleanup complete"
