package harness

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

// MetricReader wraps an in-memory ManualReader that the test harness can
// inspect after an operation completes. The reader is registered on the
// global MeterProvider alongside the OTLP exporter so metrics flow to
// both destinations.
type MetricReader struct {
	Reader *metric.ManualReader
}

// NewMetricReader creates a ManualReader suitable for test assertions.
// The caller should register it via metric.WithReader(reader.Reader)
// when building the MeterProvider. When OTel is disabled, returns nil.
func NewMetricReader() *MetricReader {
	return &MetricReader{
		Reader: metric.NewManualReader(),
	}
}

// Collect triggers a synchronous metric collection and returns the data.
func (mr *MetricReader) Collect(t *testing.T) metricdata.ResourceMetrics {
	t.Helper()
	var rm metricdata.ResourceMetrics
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := mr.Reader.Collect(ctx, &rm); err != nil {
		t.Logf("metric assertion: collect failed (non-fatal): %v", err)
	}
	return rm
}

// AssertCounterPositive asserts that a counter metric with the given name
// has recorded at least one data point with a positive value.
func AssertCounterPositive(t *testing.T, rm metricdata.ResourceMetrics, metricName string) {
	t.Helper()

	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != metricName {
				continue
			}
			if sum, ok := m.Data.(metricdata.Sum[int64]); ok {
				for _, dp := range sum.DataPoints {
					if dp.Value > 0 {
						t.Logf("metric assertion: %s has value %d", metricName, dp.Value)
						return
					}
				}
			}
			if sum, ok := m.Data.(metricdata.Sum[float64]); ok {
				for _, dp := range sum.DataPoints {
					if dp.Value > 0 {
						t.Logf("metric assertion: %s has value %f", metricName, dp.Value)
						return
					}
				}
			}
		}
	}

	var found []string
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			found = append(found, m.Name)
		}
	}
	t.Errorf("metric assertion: counter %q not found or not positive (found metrics: %v)",
		metricName, found)
}

// AssertHistogramRecorded asserts that a histogram metric with the given
// name has at least one recorded data point (count > 0).
func AssertHistogramRecorded(t *testing.T, rm metricdata.ResourceMetrics, metricName string) {
	t.Helper()

	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != metricName {
				continue
			}
			if hist, ok := m.Data.(metricdata.Histogram[float64]); ok {
				for _, dp := range hist.DataPoints {
					if dp.Count > 0 {
						t.Logf("metric assertion: %s has %d recordings, sum=%f",
							metricName, dp.Count, dp.Sum)
						return
					}
				}
			}
			if hist, ok := m.Data.(metricdata.Histogram[int64]); ok {
				for _, dp := range hist.DataPoints {
					if dp.Count > 0 {
						t.Logf("metric assertion: %s has %d recordings, sum=%d",
							metricName, dp.Count, dp.Sum)
						return
					}
				}
			}
		}
	}

	var found []string
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			found = append(found, m.Name)
		}
	}
	t.Errorf("metric assertion: histogram %q not found or empty (found metrics: %v)",
		metricName, found)
}

// AssertMetricWithAttribute asserts that a metric has at least one data
// point carrying the specified attribute key-value pair.
func AssertMetricWithAttribute(t *testing.T, rm metricdata.ResourceMetrics, metricName, attrKey, attrValue string) {
	t.Helper()

	target := attribute.String(attrKey, attrValue)

	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != metricName {
				continue
			}
			if hasAttributeInMetric(m, target) {
				t.Logf("metric assertion: %s has attribute %s=%s", metricName, attrKey, attrValue)
				return
			}
		}
	}

	t.Errorf("metric assertion: %q with %s=%s not found", metricName, attrKey, attrValue)
}

func hasAttributeInMetric(m metricdata.Metrics, target attribute.KeyValue) bool {
	checkAttrs := func(attrs attribute.Set) bool {
		val, ok := attrs.Value(target.Key)
		return ok && val.AsString() == target.Value.AsString()
	}

	switch data := m.Data.(type) {
	case metricdata.Sum[int64]:
		for _, dp := range data.DataPoints {
			if checkAttrs(dp.Attributes) {
				return true
			}
		}
	case metricdata.Sum[float64]:
		for _, dp := range data.DataPoints {
			if checkAttrs(dp.Attributes) {
				return true
			}
		}
	case metricdata.Histogram[float64]:
		for _, dp := range data.DataPoints {
			if checkAttrs(dp.Attributes) {
				return true
			}
		}
	case metricdata.Histogram[int64]:
		for _, dp := range data.DataPoints {
			if checkAttrs(dp.Attributes) {
				return true
			}
		}
	}
	return false
}
