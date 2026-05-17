package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel/trace"
)

// TraceContext holds per-test tracing state. Tests that want trace bundles
// on failure create one via StartTestTrace, use its Context for gRPC calls,
// and register cleanup via RegisterCleanup.
type TraceContext struct {
	Span     trace.Span
	TraceID  string
	ctx      context.Context
	queryURL string
}

// Context returns the context carrying the root test span. Use this for
// all gRPC calls within the test to propagate trace context.
func (tc *TraceContext) Context() context.Context {
	return tc.ctx
}

// StartTestTrace creates a root span for a test and returns a TraceContext.
// When tracing is disabled (no Jaeger), returns a TraceContext wrapping the
// original context with a no-op span.
func StartTestTrace(ctx context.Context, t *testing.T, jaeger *JaegerContainer) *TraceContext {
	ctx, span := Tracer().Start(ctx, "test.run",
		trace.WithAttributes(),
	)

	tc := &TraceContext{
		Span:    span,
		TraceID: span.SpanContext().TraceID().String(),
		ctx:     ctx,
	}

	if jaeger != nil {
		tc.queryURL = jaeger.QueryURL
	}

	return tc
}

// RegisterCleanup registers a t.Cleanup that ends the root span and, on
// test failure, exports the trace bundle to the output directory.
func (tc *TraceContext) RegisterCleanup(t *testing.T, outputDir string) {
	t.Cleanup(func() {
		tc.Span.End()

		if !t.Failed() || tc.queryURL == "" {
			return
		}

		// Allow a brief delay for the batch exporter to flush spans to Jaeger.
		time.Sleep(2 * time.Second)

		tracesDir := filepath.Join(outputDir, "traces")
		if err := os.MkdirAll(tracesDir, 0o755); err != nil {
			t.Logf("trace bundle: failed to create traces dir: %v", err)
			return
		}

		safeName := sanitizeTestName(t.Name())
		outPath := filepath.Join(tracesDir, safeName+".json")

		if err := exportTraceBundle(tc.queryURL, tc.TraceID, outPath); err != nil {
			t.Logf("trace bundle: export failed for trace %s: %v", tc.TraceID, err)
			return
		}

		t.Logf("trace bundle: written to %s (trace_id=%s)", outPath, tc.TraceID)
	})
}

// exportTraceBundle queries the Jaeger API for a trace and writes it to a file.
func exportTraceBundle(jaegerQueryURL, traceID, outputPath string) error {
	url := fmt.Sprintf("%s/api/traces/%s?prettyPrint=true", jaegerQueryURL, traceID)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("query jaeger: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("jaeger returned %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	// Pretty-print the JSON for readability.
	var pretty json.RawMessage
	if json.Unmarshal(body, &pretty) == nil {
		if formatted, fmtErr := json.MarshalIndent(pretty, "", "  "); fmtErr == nil {
			body = formatted
		}
	}

	if err := os.WriteFile(outputPath, body, 0o644); err != nil {
		return fmt.Errorf("write trace file: %w", err)
	}

	return nil
}

func sanitizeTestName(name string) string {
	name = strings.ReplaceAll(name, "/", "_")
	name = strings.ReplaceAll(name, " ", "_")
	return name
}
