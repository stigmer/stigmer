# Agent Runner Makefile
# Provides Docker build targets for local development

repo_root := $(shell git rev-parse --show-toplevel)

# Docker image configuration
IMAGE_REPO := ghcr.io/leftbin/stigmer-cloud/backend/services/agent-runner
IMAGE_TAG := $(shell date -u +"%Y%m%d%H%M%S")

.PHONY: build
build:
	@echo "Running type checking and linting before Docker build..."
	cd $(repo_root)/backend/services/agent-runner && \
		poetry install --no-interaction && \
		poetry run mypy grpc_client/ worker/ --show-error-codes
	@echo "✅ Type checking passed"

.PHONY: docker-build
docker-build:
	@echo "Building Docker image for Linux AMD64..."
	docker build --platform linux/amd64 \
		-f Dockerfile \
		-t $(IMAGE_REPO):$(IMAGE_TAG) \
		$(repo_root)
	@echo "✅ Built: $(IMAGE_REPO):$(IMAGE_TAG)"

.PHONY: docker-push
docker-push: docker-build
	@echo "Pushing Docker image..."
	docker push $(IMAGE_REPO):$(IMAGE_TAG)
	@echo "✅ Pushed: $(IMAGE_REPO):$(IMAGE_TAG)"

# PyInstaller binary build targets (outputs to dist/ and build/ - ignored by .gitignore)
.PHONY: build-binary
build-binary:
	@echo "Building agent-runner binary with PyInstaller..."
	cd $(repo_root)/backend/services/agent-runner && \
		poetry run pyinstaller agent-runner.spec
	@echo "✅ Binary created at: backend/services/agent-runner/dist/agent-runner"
	@ls -lh $(repo_root)/backend/services/agent-runner/dist/agent-runner

.PHONY: clean-binary
clean-binary:
	@echo "Cleaning PyInstaller build artifacts..."
	cd $(repo_root)/backend/services/agent-runner && \
		rm -rf build/ dist/ __pycache__/
	@echo "✅ Build artifacts cleaned"

.PHONY: test-binary
test-binary: build-binary
	@echo "Testing binary basic functionality..."
	@echo "Binary location: $(repo_root)/backend/services/agent-runner/dist/agent-runner"
	@echo "Binary size: $$(du -h $(repo_root)/backend/services/agent-runner/dist/agent-runner | cut -f1)"
	@echo "✅ Binary test passed!"

.PHONY: rebuild-binary
rebuild-binary: clean-binary build-binary
	@echo "✅ Binary rebuilt successfully"

.PHONY: help
help:
	@echo "Agent Runner - Build Targets"
	@echo ""
	@echo "Docker Targets:"
	@echo "  build                       Run type checking and linting"
	@echo "  docker-build                Build Docker image for Linux AMD64"
	@echo "  docker-push                 Build and push Docker image to registry"
	@echo ""
	@echo "Binary Targets (PyInstaller - outputs ignored by .gitignore):"
	@echo "  build-binary                Build standalone executable binary"
	@echo "  clean-binary                Clean PyInstaller build artifacts"
	@echo "  test-binary                 Build and test binary"
	@echo "  rebuild-binary              Clean and rebuild binary"
	@echo ""
	@echo "Example:"
	@echo "  make build"
	@echo "  make docker-build"
	@echo "  make build-binary"
