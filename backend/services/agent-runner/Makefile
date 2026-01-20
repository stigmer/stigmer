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

.PHONY: help
help:
	@echo "Agent Runner - Docker Build Targets"
	@echo ""
	@echo "Targets:"
	@echo "  build                       Run type checking and linting"
	@echo "  docker-build                Build Docker image for Linux AMD64"
	@echo "  docker-push                 Build and push Docker image to registry"
	@echo ""
	@echo "Example:"
	@echo "  make build"
	@echo "  make docker-build"
	@echo "  make docker-push"
