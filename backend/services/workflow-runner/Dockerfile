FROM golang:1.24 AS builder

WORKDIR /app

# Copy Go modules files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -o workflow-runner ./cmd/worker

# Final stage
FROM alpine:3.19

# Install CA certificates for HTTPS
RUN apk --no-cache add ca-certificates

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/workflow-runner .

# Run as non-root user
RUN addgroup -g 1000 workflow && \
    adduser -D -u 1000 -G workflow workflow && \
    chown -R workflow:workflow /app

USER workflow

CMD ["./workflow-runner"]

