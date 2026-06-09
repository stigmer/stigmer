# Buf CLI binary (override with BUF=/path/to/buf if needed)
BUF ?= buf

# Local, pinned Go codegen plugins. We run these on-machine instead of via
# buf.build's remote plugin executor so `go-stubs` has no network dependency on
# buf.build. Versions MUST match the references that produced the committed
# stubs (see buf.gen.go.yaml) so regeneration stays byte-identical.
GO_PROTOC_GEN_GO_VERSION      ?= v1.36.6
GO_PROTOC_GEN_GO_GRPC_VERSION ?= v1.5.1
TOOLS_BIN := $(CURDIR)/.tools/bin

# Set STUBS_FORCE=1 to regenerate even when protos are unchanged (CI does this).
export STUBS_FORCE

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
	@echo "    make java-stubs   - Generate Java stubs only"
	@echo "    make python-stubs - Generate Python stubs only"
	@echo "    make ts-stubs     - Generate TypeScript stubs only"
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
build: lint fmt go-stubs java-stubs python-stubs ts-stubs

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
clean: go-stubs-clean java-stubs-clean python-stubs-clean ts-stubs-clean

.PHONY: prep
prep:
	$(MAKE) clean
	$(MAKE) go-stubs-init
	$(MAKE) java-stubs-init
	$(MAKE) python-stubs-init
	$(MAKE) ts-stubs-init

# --------------------------------------------------------------------------- #
#  Go protobuf/gRPC stub generation
# --------------------------------------------------------------------------- #
GO_STUBS_DIR := stubs/go

.PHONY: go-stubs-clean
go-stubs-clean:
	@echo "Cleaning Go stubs..."
	@rm -rf $(GO_STUBS_DIR)

.PHONY: go-stubs-init
go-stubs-init:
	@mkdir -p $(GO_STUBS_DIR)
	@# Create go.mod immediately for go.work reference
	@if [ ! -f "$(GO_STUBS_DIR)/go.mod" ]; then \
		echo 'module github.com/stigmer/stigmer/apis/stubs/go\n\ngo 1.24\n\nrequire (\n\tbuf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go v1.36.11-20251209175733-2a1774d88802.1\n\tgoogle.golang.org/grpc v1.78.0\n\tgoogle.golang.org/protobuf v1.36.11\n)' > $(GO_STUBS_DIR)/go.mod; \
	fi
	@# Create BUILD.bazel immediately to make it a valid Bazel package
	@echo '# Gazelle will automatically generate Go library rules for this directory' > $(GO_STUBS_DIR)/BUILD.bazel
	@echo '# This BUILD file makes the directory a valid Bazel package' >> $(GO_STUBS_DIR)/BUILD.bazel
	@echo '' >> $(GO_STUBS_DIR)/BUILD.bazel
	@echo 'exports_files([' >> $(GO_STUBS_DIR)/BUILD.bazel
	@echo '    "go.mod",' >> $(GO_STUBS_DIR)/BUILD.bazel
	@echo '    "go.sum",' >> $(GO_STUBS_DIR)/BUILD.bazel
	@echo '])' >> $(GO_STUBS_DIR)/BUILD.bazel

.PHONY: go-stubs-fix-structure
go-stubs-fix-structure:
	@# Fix nested directory structure created by buf's go_package_prefix
	@if [ -d "$(GO_STUBS_DIR)/github.com" ]; then \
		echo "Fixing nested Go stubs directory structure..."; \
		mv $(GO_STUBS_DIR)/github.com/stigmer/stigmer/apis/stubs/go/* $(GO_STUBS_DIR)/ 2>/dev/null || true; \
		rm -rf $(GO_STUBS_DIR)/github.com; \
		echo "✓ Directory structure fixed"; \
	fi

.PHONY: go-stubs-ensure-gomod
go-stubs-ensure-gomod:
	@# Ensure go.mod exists for the Go module
	@if [ ! -f "$(GO_STUBS_DIR)/go.mod" ]; then \
		echo "Creating go.mod for Go stubs..."; \
		echo 'module github.com/stigmer/stigmer/apis/stubs/go\n\ngo 1.24\n\nrequire (\n\tbuf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go v1.36.11-20251209175733-2a1774d88802.1\n\tgoogle.golang.org/grpc v1.78.0\n\tgoogle.golang.org/protobuf v1.36.11\n)' > $(GO_STUBS_DIR)/go.mod; \
		cd $(GO_STUBS_DIR) && go mod tidy; \
		echo "✓ go.mod created"; \
	else \
		echo "go.mod exists, running go mod tidy..."; \
		cd $(GO_STUBS_DIR) && go mod tidy; \
		echo "✓ go.mod updated"; \
	fi

.PHONY: ensure-build-files
ensure-build-files:
	@python3 ../tools/bazel/ensure_build_files.py

.PHONY: go-stubs-generate-build-files
go-stubs-generate-build-files: ensure-build-files
	@echo "Generating BUILD.bazel files for Go stubs..."
	@cd .. && ./bazelw run //:gazelle
	@echo "✓ BUILD.bazel files generated"

.PHONY: go-stubs-tools
go-stubs-tools:
	@# Install pinned codegen plugins into .tools/bin if missing or out of date.
	@mkdir -p $(TOOLS_BIN)
	@if [ "$$($(TOOLS_BIN)/protoc-gen-go --version 2>/dev/null)" != "protoc-gen-go $(GO_PROTOC_GEN_GO_VERSION)" ]; then \
		echo "Installing protoc-gen-go $(GO_PROTOC_GEN_GO_VERSION)..."; \
		GOBIN=$(TOOLS_BIN) go install google.golang.org/protobuf/cmd/protoc-gen-go@$(GO_PROTOC_GEN_GO_VERSION); \
	fi
	@if [ "$$($(TOOLS_BIN)/protoc-gen-go-grpc --version 2>/dev/null)" != "protoc-gen-go-grpc $(GO_PROTOC_GEN_GO_GRPC_VERSION:v%=%)" ]; then \
		echo "Installing protoc-gen-go-grpc $(GO_PROTOC_GEN_GO_GRPC_VERSION)..."; \
		GOBIN=$(TOOLS_BIN) go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@$(GO_PROTOC_GEN_GO_GRPC_VERSION); \
	fi

.PHONY: go-stubs
go-stubs: go-stubs-init go-stubs-tools
	@echo "Generating Go stubs..."
	@rc=0; bash scripts/gen-stubs.sh go || rc=$$?; \
	if [ $$rc -eq 2 ]; then \
		echo "✓ Go stubs up to date (protos unchanged); skipping"; \
	elif [ $$rc -eq 0 ]; then \
		$(MAKE) go-stubs-ensure-gomod; \
		$(MAKE) go-stubs-generate-build-files; \
		echo "✓ Go stubs generated successfully"; \
	else \
		echo "✗ Go stub generation failed — existing stubs left intact" >&2; \
		exit $$rc; \
	fi

# --------------------------------------------------------------------------- #
#  Java protobuf/gRPC stub generation
# --------------------------------------------------------------------------- #
JAVA_STUBS_DIR := stubs/java

.PHONY: java-stubs-clean
java-stubs-clean:
	@echo "Cleaning Java stubs..."
	@rm -rf $(JAVA_STUBS_DIR)/src/main/java/ai
	@rm -rf $(JAVA_STUBS_DIR)/src/main/java/buf

.PHONY: java-stubs-init
java-stubs-init:
	@mkdir -p $(JAVA_STUBS_DIR)/src/main/java

.PHONY: java-stubs
java-stubs: java-stubs-init
	@echo "Generating Java stubs..."
	@rc=0; bash scripts/gen-stubs.sh java || rc=$$?; \
	if [ $$rc -eq 2 ]; then \
		echo "✓ Java stubs up to date (protos unchanged); skipping"; \
	elif [ $$rc -eq 0 ]; then \
		echo "✓ Java stubs generated successfully"; \
	else \
		echo "✗ Java stub generation failed — existing stubs left intact" >&2; \
		exit $$rc; \
	fi

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
python-stubs: python-stubs-init
	@echo "Generating Python stubs..."
	@rc=0; bash scripts/gen-stubs.sh python || rc=$$?; \
	if [ $$rc -eq 2 ]; then \
		echo "✓ Python stubs up to date (protos unchanged); skipping"; \
	elif [ $$rc -eq 0 ]; then \
		$(MAKE) python-stubs-add-py-typed-markers; \
		echo "✓ Python stubs generated successfully"; \
	else \
		echo "✗ Python stub generation failed — existing stubs left intact" >&2; \
		exit $$rc; \
	fi

# --------------------------------------------------------------------------- #
#  TypeScript protobuf/Connect-RPC stub generation
# --------------------------------------------------------------------------- #
TS_STUBS_DIR := stubs/ts

.PHONY: ts-stubs-clean
ts-stubs-clean:
	@echo "Cleaning TypeScript stubs..."
	@rm -rf $(TS_STUBS_DIR)/ai
	@rm -rf $(TS_STUBS_DIR)/buf

.PHONY: ts-stubs-init
ts-stubs-init:
	@mkdir -p $(TS_STUBS_DIR)

.PHONY: ts-stubs
ts-stubs: ts-stubs-init
	@echo "Generating TypeScript stubs..."
	@rc=0; bash scripts/gen-stubs.sh ts || rc=$$?; \
	if [ $$rc -eq 2 ]; then \
		echo "✓ TypeScript stubs up to date (protos unchanged); skipping"; \
	elif [ $$rc -eq 0 ]; then \
		echo "✓ TypeScript stubs generated successfully"; \
	else \
		echo "✗ TypeScript stub generation failed — existing stubs left intact" >&2; \
		exit $$rc; \
	fi
