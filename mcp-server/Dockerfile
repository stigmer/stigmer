# Multi-stage Docker build for mcp-server-stigmer.
#
# Proto stubs live inside the mcp-server module (mcp-server/proto/), so the
# build context only needs the mcp-server/ directory.
#
#   docker build -f mcp-server/Dockerfile -t mcp-server-stigmer .
#
# ---- Build stage ----
# Pin the builder to the *native* build platform (always the amd64 runner) and
# cross-compile to the target arch. Go is a native cross-compiler, so this
# avoids running the toolchain under slow QEMU emulation for arm64.
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS builder

ARG BUILD_VERSION=docker
ARG TARGETOS
ARG TARGETARCH

WORKDIR /build

# Copy module files first for better layer caching.
COPY mcp-server/go.mod mcp-server/go.sum mcp-server/
RUN --mount=type=cache,target=/go/pkg/mod \
    cd mcp-server && go mod download

# Copy the MCP server source (includes proto/ stubs).
COPY mcp-server/ mcp-server/

# Build a statically linked binary, cross-compiling to the requested target.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    cd mcp-server && \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build \
    -ldflags="-s -w -X github.com/stigmer/stigmer/mcp-server/internal/server.buildVersion=${BUILD_VERSION}" \
    -o /mcp-server-stigmer \
    ./cmd/mcp-server-stigmer

# ---- Runtime stage ----
FROM alpine:3.19

# CA certificates are needed for TLS connections to stigmer-server.
RUN apk --no-cache add ca-certificates

# Run as a non-root user.
RUN addgroup -g 1000 stigmer && \
    adduser -D -u 1000 -G stigmer stigmer

WORKDIR /app
COPY --from=builder /mcp-server-stigmer .
RUN chown -R stigmer:stigmer /app

USER stigmer

# Default HTTP port (overridable via STIGMER_MCP_HTTP_PORT).
EXPOSE 8080

# Health check for container orchestrators.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/health || exit 1

ENTRYPOINT ["./mcp-server-stigmer"]
