# Multi-stage Docker build for mcp-server-stigmer.
#
# Proto stubs live inside the mcp-server module (mcp-server/proto/), so the
# build context only needs the mcp-server/ directory.
#
#   docker build -f mcp-server/Dockerfile -t mcp-server-stigmer .
#
# ---- Build stage ----
FROM golang:1.25-alpine AS builder

ARG BUILD_VERSION=docker

WORKDIR /build

# Copy module files first for better layer caching.
COPY mcp-server/go.mod mcp-server/go.sum mcp-server/
RUN cd mcp-server && go mod download

# Copy the MCP server source (includes proto/ stubs).
COPY mcp-server/ mcp-server/

# Build a statically linked binary.
RUN cd mcp-server && \
    CGO_ENABLED=0 GOOS=linux go build \
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
