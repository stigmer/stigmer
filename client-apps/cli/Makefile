.PHONY: build
build:
	@echo "Building CLI..."
	cd ../.. && bazel build //client-apps/cli:stigmer

.PHONY: run
run: build
	@bazel-bin/client-apps/cli/stigmer_/stigmer $(ARGS)

.PHONY: clean
clean:
	cd ../.. && bazel clean

.PHONY: test
test:
	cd ../.. && bazel test //client-apps/cli/...
