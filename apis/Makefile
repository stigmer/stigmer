# Buf CLI binary (override with BUF=/path/to/buf if needed)
BUF ?= buf

.PHONY: help
help:
	@echo "Available targets:"
	@echo ""
	@echo "  Build:"
	@echo "    make build        - Lint, format, and generate all stubs"
	@echo "    make protos       - Alias for build"
	@echo ""
	@echo "  Linting & Formatting:"
	@echo "    make lint         - Run buf lint"
	@echo "    make fmt          - Format proto files"
	@echo ""
	@echo "  Stub Generation:"
	@echo "    make go-stubs     - Generate Go stubs only"
	@echo "    make python-stubs - Generate Python stubs only"
	@echo ""
	@echo "  Publishing:"
	@echo "    make push         - Push protos to Buf Schema Registry (buf.build/stigmer/stigmer)"
	@echo "    make release      - Lint, format, generate, and push to Buf (full release)"
	@echo ""
	@echo "  Maintenance:"
	@echo "    make clean        - Remove all generated stubs"
	@echo "    make update       - Update buf dependencies"
	@echo "    make prep         - Clean and initialize stub directories"

# --------------------------------------------------------------------------- #
#  Core build targets
# --------------------------------------------------------------------------- #
.PHONY: build
build: lint fmt go-stubs python-stubs

.PHONY: protos
protos: build

.PHONY: lint
lint:
	$(BUF) lint

.PHONY: fmt
fmt:
	$(BUF) format -w

.PHONY: update
update:
	$(BUF) dep update

# --------------------------------------------------------------------------- #
#  Publishing to Buf Schema Registry
# --------------------------------------------------------------------------- #
.PHONY: push
push:
	@echo "Pushing protos to Buf Schema Registry..."
	@$(BUF) push
	@echo "✓ Protos published successfully to buf.build/stigmer/stigmer"

.PHONY: release
release: lint fmt push
	@echo "✓ Full release complete (linted, formatted, and pushed to Buf)"

# --------------------------------------------------------------------------- #
#  Cleanup and initialization
# --------------------------------------------------------------------------- #
.PHONY: clean
clean: go-stubs-clean python-stubs-clean

.PHONY: prep
prep:
	$(MAKE) clean
	$(MAKE) go-stubs-init
	$(MAKE) python-stubs-init

# --------------------------------------------------------------------------- #
#  Go protobuf/gRPC stub generation
# --------------------------------------------------------------------------- #
GO_STUBS_DIR := ../internal/gen

.PHONY: go-stubs-clean
go-stubs-clean:
	@echo "Cleaning Go stubs..."
	@rm -rf $(GO_STUBS_DIR)

.PHONY: go-stubs-init
go-stubs-init:
	@mkdir -p $(GO_STUBS_DIR)

.PHONY: go-stubs-fix-structure
go-stubs-fix-structure:
	@# Fix nested directory structure created by buf's go_package_prefix
	@if [ -d "$(GO_STUBS_DIR)/github.com" ]; then \
		echo "Fixing nested Go stubs directory structure..."; \
		mv $(GO_STUBS_DIR)/github.com/stigmer/stigmer/internal/gen/* $(GO_STUBS_DIR)/ 2>/dev/null || true; \
		rm -rf $(GO_STUBS_DIR)/github.com; \
		echo "✓ Directory structure fixed"; \
	fi

.PHONY: go-stubs-ensure-gomod
go-stubs-ensure-gomod:
	@# Ensure go.mod exists for the Go module
	@if [ ! -f "$(GO_STUBS_DIR)/go.mod" ]; then \
		echo "Creating go.mod for Go stubs..."; \
		echo 'module github.com/stigmer/stigmer/internal/gen\n\ngo 1.24\n\nrequire (\n\tbuf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go v1.36.11-20251209175733-2a1774d88802.1\n\tgoogle.golang.org/grpc v1.78.0\n\tgoogle.golang.org/protobuf v1.36.11\n)' > $(GO_STUBS_DIR)/go.mod; \
		cd $(GO_STUBS_DIR) && go mod tidy; \
		echo "✓ go.mod created"; \
	else \
		echo "go.mod exists, running go mod tidy..."; \
		cd $(GO_STUBS_DIR) && go mod tidy; \
		echo "✓ go.mod updated"; \
	fi

.PHONY: go-stubs-generate-build-files
go-stubs-generate-build-files:
	@echo "Generating BUILD.bazel files for Go stubs..."
	@cd .. && ./bazelw run //:gazelle
	@echo "✓ BUILD.bazel files generated"

.PHONY: go-stubs
go-stubs: go-stubs-clean go-stubs-init
	@echo "Generating Go stubs..."
	@$(BUF) generate --template buf.gen.go.yaml
	@$(MAKE) go-stubs-fix-structure
	@$(MAKE) go-stubs-ensure-gomod
	@$(MAKE) go-stubs-generate-build-files
	@echo "✓ Go stubs generated successfully"

# --------------------------------------------------------------------------- #
#  Python protobuf/gRPC stub generation
# --------------------------------------------------------------------------- #
PYTHON_STUBS_DIR := stubs/python
PYTHON_STUBS_DIR_STIGMER := $(PYTHON_STUBS_DIR)/stigmer

.PHONY: python-stubs-clean
python-stubs-clean:
	@echo "Cleaning Python stubs..."
	@rm -rf $(PYTHON_STUBS_DIR_STIGMER)/ai
	@rm -rf $(PYTHON_STUBS_DIR_STIGMER)/buf

.PHONY: python-stubs-init
python-stubs-init:
	@mkdir -p $(PYTHON_STUBS_DIR_STIGMER)
	@touch $(PYTHON_STUBS_DIR)/__init__.py
	@touch $(PYTHON_STUBS_DIR_STIGMER)/__init__.py

.PHONY: python-stubs-add-py-typed-markers
python-stubs-add-py-typed-markers:
	@touch $(PYTHON_STUBS_DIR_STIGMER)/ai/py.typed

.PHONY: python-stubs
python-stubs: python-stubs-clean python-stubs-init
	@echo "Generating Python stubs..."
	@$(BUF) generate --template buf.gen.python.yaml
	@$(MAKE) python-stubs-add-py-typed-markers
	@echo "✓ Python stubs generated successfully"
