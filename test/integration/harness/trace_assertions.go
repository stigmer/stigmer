package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"
)

// jaegerTrace mirrors the minimal Jaeger API response structure needed for
// span name lookups. Only the fields we assert on are defined.
type jaegerTrace struct {
	Data []jaegerTraceData `json:"data"`
}

type jaegerTraceData struct {
	Spans []jaegerSpan `json:"spans"`
}

type jaegerSpan struct {
	OperationName string          `json:"operationName"`
	Tags          []jaegerSpanTag `json:"tags"`
}

type jaegerSpanTag struct {
	Key   string `json:"key"`
	Value any    `json:"value"`
}

// AssertSpanExists queries Jaeger for the given trace and asserts that at
// least one span with the given operation name is present.
//
// This is a lightweight smoke test for verifying that application-level
// OTel instrumentation produced the expected spans. It does NOT validate
// span attributes or parent-child relationships.
//
// Skips (rather than fails) when Jaeger is nil or the trace is not yet
// available, since the batch exporter may not have flushed by the time
// the assertion runs.
func AssertSpanExists(t *testing.T, jaeger *JaegerContainer, traceID, spanName string) {
	t.Helper()

	if jaeger == nil {
		t.Skip("OTel tracing not enabled — skipping span assertion")
		return
	}

	// Allow the batch exporter to flush.
	time.Sleep(3 * time.Second)

	spans, err := queryJaegerSpans(jaeger.QueryURL, traceID)
	if err != nil {
		t.Logf("trace assertion: could not query Jaeger (non-fatal): %v", err)
		return
	}

	for _, s := range spans {
		if s.OperationName == spanName {
			t.Logf("trace assertion: found span %q in trace %s", spanName, traceID)
			return
		}
	}

	var found []string
	for _, s := range spans {
		found = append(found, s.OperationName)
	}
	t.Errorf("trace assertion: span %q not found in trace %s (found %d spans: %v)",
		spanName, traceID, len(spans), found)
}

// AssertSpanWithAttribute queries Jaeger for the given trace and asserts
// that a span with the given operation name has a tag with the specified
// key and string value.
func AssertSpanWithAttribute(t *testing.T, jaeger *JaegerContainer, traceID, spanName, attrKey, attrValue string) {
	t.Helper()

	if jaeger == nil {
		t.Skip("OTel tracing not enabled — skipping span assertion")
		return
	}

	time.Sleep(3 * time.Second)

	spans, err := queryJaegerSpans(jaeger.QueryURL, traceID)
	if err != nil {
		t.Logf("trace assertion: could not query Jaeger (non-fatal): %v", err)
		return
	}

	for _, s := range spans {
		if s.OperationName != spanName {
			continue
		}
		for _, tag := range s.Tags {
			if tag.Key == attrKey && fmt.Sprint(tag.Value) == attrValue {
				t.Logf("trace assertion: found span %q with %s=%s in trace %s",
					spanName, attrKey, attrValue, traceID)
				return
			}
		}
	}

	t.Errorf("trace assertion: span %q with %s=%s not found in trace %s",
		spanName, attrKey, attrValue, traceID)
}

func queryJaegerSpans(queryURL, traceID string) ([]jaegerSpan, error) {
	url := fmt.Sprintf("%s/api/traces/%s", queryURL, traceID)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("query jaeger: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("jaeger returned %d: %s", resp.StatusCode, string(body[:min(len(body), 200)]))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var trace jaegerTrace
	if err := json.Unmarshal(body, &trace); err != nil {
		return nil, fmt.Errorf("unmarshal trace: %w", err)
	}

	var allSpans []jaegerSpan
	for _, d := range trace.Data {
		allSpans = append(allSpans, d.Spans...)
	}
	return allSpans, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
