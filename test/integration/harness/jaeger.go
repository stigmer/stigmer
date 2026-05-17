package harness

import (
	"context"
	"fmt"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// JaegerContainer holds a running Jaeger all-in-one instance that collects
// spans from all services under test via OTLP and exposes a query API for
// trace retrieval on test failure.
type JaegerContainer struct {
	Container    testcontainers.Container
	OTLPAddress  string // host:port for OTLP/gRPC (4317)
	QueryURL     string // http://host:port for Jaeger UI + Query API
	OTLPEndpoint string // http://host:port for OTEL_EXPORTER_OTLP_ENDPOINT
}

// StartJaeger starts a Jaeger all-in-one container with OTLP ingestion enabled.
// The container provides:
//   - OTLP/gRPC on 4317 (span receiver for all services)
//   - Jaeger UI + Query API on 16686 (trace retrieval and visual debugging)
func StartJaeger(ctx context.Context) (*JaegerContainer, error) {
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "jaegertracing/all-in-one:1.76.0",
			ExposedPorts: []string{"4317/tcp", "16686/tcp"},
			Env: map[string]string{
				"COLLECTOR_OTLP_ENABLED": "true",
			},
			WaitingFor: wait.ForHTTP("/").WithPort("16686/tcp"),
		},
		Started: true,
	})
	if err != nil {
		return nil, fmt.Errorf("start jaeger container: %w", err)
	}

	host, err := container.Host(ctx)
	if err != nil {
		return nil, fmt.Errorf("get jaeger host: %w", err)
	}

	otlpPort, err := container.MappedPort(ctx, "4317/tcp")
	if err != nil {
		return nil, fmt.Errorf("get jaeger otlp port: %w", err)
	}

	queryPort, err := container.MappedPort(ctx, "16686/tcp")
	if err != nil {
		return nil, fmt.Errorf("get jaeger query port: %w", err)
	}

	otlpAddress := fmt.Sprintf("%s:%s", host, otlpPort.Port())

	return &JaegerContainer{
		Container:    container,
		OTLPAddress:  otlpAddress,
		QueryURL:     fmt.Sprintf("http://%s:%s", host, queryPort.Port()),
		OTLPEndpoint: fmt.Sprintf("http://%s", otlpAddress),
	}, nil
}
