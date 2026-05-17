package otel

import (
	"context"
	"fmt"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/baggage"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// InitTracing configures the global OTel TracerProvider from standard env vars.
// When OTEL_EXPORTER_OTLP_ENDPOINT is not set, this is a no-op and returns a
// nil shutdown function. Zero overhead when tracing is disabled.
func InitTracing(ctx context.Context, serviceName string) (shutdown func(context.Context) error, err error) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		return nil, nil
	}

	conn, err := grpc.NewClient(endpoint,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return nil, fmt.Errorf("dial otlp endpoint %s: %w", endpoint, err)
	}

	exporter, err := otlptracegrpc.New(ctx, otlptracegrpc.WithGRPCConn(conn))
	if err != nil {
		return nil, fmt.Errorf("create otlp exporter: %w", err)
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceNameKey.String(serviceName),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("create otel resource: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return tp.Shutdown, nil
}

// SetBaggage attaches the given key-value pairs to the context as W3C baggage.
// The composite propagator (TraceContext + Baggage) configured by InitTracing
// ensures these values propagate through outbound gRPC and HTTP calls
// automatically via the W3C baggage header.
//
// Keys with empty values are silently skipped.
func SetBaggage(ctx context.Context, items map[string]string) context.Context {
	var members []baggage.Member
	for k, v := range items {
		if v == "" {
			continue
		}
		m, err := baggage.NewMember(k, v)
		if err != nil {
			continue
		}
		members = append(members, m)
	}
	if len(members) == 0 {
		return ctx
	}
	bag, err := baggage.New(members...)
	if err != nil {
		return ctx
	}
	return baggage.ContextWithBaggage(ctx, bag)
}
