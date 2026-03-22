# Multi-stage Dockerfile for workflow-runner service
#
# Build context: Repository root
# Build command: docker build -f backend/services/workflow-runner/Dockerfile -t workflow-runner .

# ---------- Builder Stage ----------
FROM golang:1.24 AS builder

# Match repository structure so the go.mod replace directive resolves:
#   replace github.com/stigmer/stigmer/apis/stubs/go => ../../../apis/stubs/go
WORKDIR /app/backend/services/workflow-runner

# Copy dependency manifests first for layer caching
COPY backend/services/workflow-runner/go.mod backend/services/workflow-runner/go.sum ./

# Copy local path dependency referenced by replace directive in go.mod
COPY apis/stubs/go /app/apis/stubs/go

RUN go mod download

# Copy source code
COPY backend/services/workflow-runner/ .

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -o workflow-runner ./cmd/worker

# ---------- Runtime Stage ----------
FROM alpine:3.19

RUN apk --no-cache add ca-certificates

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/backend/services/workflow-runner/workflow-runner .

# Run as non-root user
RUN addgroup -g 1000 workflow && \
    adduser -D -u 1000 -G workflow workflow && \
    chown -R workflow:workflow /app

USER workflow

CMD ["./workflow-runner"]
