# The Stigmer operator's own targets. The repository's Makefile calls these
# (build-operator, test-operator, lint-operator); run them here when working
# on the module alone.
#
# Tools are installed into ./bin at pinned versions on first use, so nothing
# depends on what the machine happens to have. envtest runs a real API server
# and etcd at the Kubernetes minor k8s.io/api names, so the CRD's CEL rules
# are evaluated exactly as a cluster of that line evaluates them.

LOCALBIN := $(CURDIR)/bin
CONTROLLER_GEN := $(LOCALBIN)/controller-gen
SETUP_ENVTEST := $(LOCALBIN)/setup-envtest
CONTROLLER_TOOLS_VERSION := v0.20.1
SETUP_ENVTEST_VERSION := release-0.23
ENVTEST_K8S_VERSION = $(shell go list -m -f '{{.Version}}' k8s.io/api | sed -E 's/^v?[0-9]+\.([0-9]+).*/1.\1/')

# The image the install test loads into kind and the version it stamps; a
# release overrides both.
IMG ?= ghcr.io/stigmer/stigmer-operator:compose-dev
STIGMER_VERSION ?= compose-dev

# Third-party pieces embedded in the binary, at the versions it is tested
# against. Bump with `make vendor-cloudnative-pg vendor-temporal-chart`.
CLOUDNATIVE_PG_VERSION := 1.30.2
TEMPORAL_CHART_VERSION := 1.8.0

OPERATOR_CHART := ../helm/stigmer-operator
VERSION_FLAG := -X github.com/stigmer/stigmer/deploy/operator/internal/version.Stigmer=$(STIGMER_VERSION)

.DEFAULT_GOAL := help

.PHONY: help
help: ## List the targets
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  %-24s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

.PHONY: manifests
manifests: $(CONTROLLER_GEN) ## Generate the CRD and RBAC, and copy them into the operator chart
	$(CONTROLLER_GEN) rbac:roleName=stigmer-operator crd paths="./..." \
		output:crd:artifacts:config=config/crd/bases output:rbac:artifacts:config=config/rbac
	mkdir -p $(OPERATOR_CHART)/crds $(OPERATOR_CHART)/files
	cp config/crd/bases/stigmer.ai_stigmers.yaml $(OPERATOR_CHART)/crds/stigmer.ai_stigmers.yaml
	cp config/rbac/role.yaml $(OPERATOR_CHART)/files/role.yaml

.PHONY: generate
generate: $(CONTROLLER_GEN) ## Generate the API types' deepcopy methods
	$(CONTROLLER_GEN) object:headerFile=hack/boilerplate.go.txt paths="./api/..."

.PHONY: generated-check
generated-check: manifests generate ## Fail when a generated file is stale
	@git diff --exit-code -- api config $(OPERATOR_CHART)/crds $(OPERATOR_CHART)/files \
		|| { echo "generated files are stale: run make manifests generate in deploy/operator" >&2; exit 1; }

.PHONY: fmt-check
fmt-check: ## Fail when a file is not gofmt -s clean
	@out="$$(gofmt -s -l .)"; if [ -n "$$out" ]; then echo "not gofmt -s clean:" >&2; echo "$$out" >&2; exit 1; fi

.PHONY: tidy-check
tidy-check: ## Fail when go.mod or go.sum is not tidy
	go mod tidy -diff

.PHONY: vet
vet: ## go vet every package
	go vet ./...

.PHONY: lint
lint: fmt-check tidy-check vet generated-check ## Every static check

.PHONY: test
test: $(SETUP_ENVTEST) ## Unit and envtest suites
	KUBEBUILDER_ASSETS="$$($(SETUP_ENVTEST) use $(ENVTEST_K8S_VERSION) --bin-dir $(LOCALBIN) -p path)" \
		go test -race -count=1 ./...

.PHONY: build
build: ## Build the operator binary into ./bin
	CGO_ENABLED=0 go build -ldflags "$(VERSION_FLAG)" -o $(LOCALBIN)/stigmer-operator ./cmd

.PHONY: docker-build
docker-build: ## Build the operator image for this machine's architecture
	docker build --build-arg STIGMER_VERSION=$(STIGMER_VERSION) -t $(IMG) .

.PHONY: vendor-cloudnative-pg
vendor-cloudnative-pg: ## Fetch CloudNativePG's release manifest at the pinned version
	curl -fsSL -o internal/manifests/cloudnative-pg/release.yaml \
		https://github.com/cloudnative-pg/cloudnative-pg/releases/download/v$(CLOUDNATIVE_PG_VERSION)/cnpg-$(CLOUDNATIVE_PG_VERSION).yaml

.PHONY: vendor-temporal-chart
vendor-temporal-chart: ## Fetch Temporal's Helm chart at the pinned version
	find internal/manifests/temporal -name 'temporal-*.tgz' -delete
	curl -fsSL -o internal/manifests/temporal/temporal-$(TEMPORAL_CHART_VERSION).tgz \
		https://github.com/temporalio/helm-charts/releases/download/temporal-$(TEMPORAL_CHART_VERSION)/temporal-$(TEMPORAL_CHART_VERSION).tgz

$(CONTROLLER_GEN):
	GOBIN=$(LOCALBIN) go install sigs.k8s.io/controller-tools/cmd/controller-gen@$(CONTROLLER_TOOLS_VERSION)

$(SETUP_ENVTEST):
	GOBIN=$(LOCALBIN) go install sigs.k8s.io/controller-runtime/tools/setup-envtest@$(SETUP_ENVTEST_VERSION)
