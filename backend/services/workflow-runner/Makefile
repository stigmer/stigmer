.PHONY: build test clean golden-tests docker-build tidy run-grpc run-worker

# Build the worker binary
build:
	go build -o bin/workflow-runner ./cmd/worker

# Build the gRPC server binary
build-grpc:
	go build -o bin/workflow-runner-grpc ./cmd/grpc-server

# Run unit tests
test:
	go test ./... -v

# Run golden test suite (requires Temporal running)
golden-tests:
	./test/golden/run_tests.sh

# Build Docker image
docker-build:
	docker build -t ghcr.io/leftbin/stigmer-cloud/backend/services/workflow-runner:latest .

# Clean build artifacts
clean:
	rm -rf bin/

# Tidy Go modules
tidy:
	go mod tidy

# Run linter
lint:
	golangci-lint run

# Format code
fmt:
	go fmt ./...

# Run the gRPC server with environment variables loaded
run-grpc:
	. .env_export && go run ./cmd/grpc-server/main.go

# Run the worker with environment variables loaded
run-worker:
	. .env_export && go run ./cmd/worker/main.go

# Run the built gRPC server binary with environment variables
run-grpc-server: build-grpc
	. .env_export && ./bin/workflow-runner-grpc

# Run the built worker binary with environment variables
run-worker-server: build
	. .env_export && ./bin/workflow-runner
