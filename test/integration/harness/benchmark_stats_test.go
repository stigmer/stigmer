package harness

// Unit tests for the benchmark cell statistics. Pure logic — no harness
// processes, no API keys, no build tags. Run from test/integration/ with:
//
//	go test ./harness/ -run TestNewBenchmarkStat

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// sample builds a minimal BenchmarkResult for stats tests. Billable cost is
// the sort key of interest; model and token buckets are set where a case
// needs them.
func sample(billableMicros int64, model string) *BenchmarkResult {
	return &BenchmarkResult{
		Harness:            "native",
		Model:              model,
		BillableCostMicros: billableMicros,
	}
}

func TestNewBenchmarkStat(t *testing.T) {
	tests := []struct {
		name           string
		samples        []*BenchmarkResult
		cold           *BenchmarkResult
		wantNil        bool
		wantN          int
		wantMedian     int64
		wantSpread     int64
		wantModels     []string
		wantModelDrift bool
	}{
		{
			name:    "no samples returns nil",
			samples: nil,
			wantNil: true,
		},
		{
			name:    "all-nil samples returns nil",
			samples: []*BenchmarkResult{nil, nil},
			cold:    sample(100, "m"),
			wantNil: true,
		},
		{
			name:       "single sample is its own median with zero spread",
			samples:    []*BenchmarkResult{sample(4200, "claude-sonnet-4-6")},
			wantN:      1,
			wantMedian: 4200,
			wantSpread: 0,
			wantModels: []string{"claude-sonnet-4-6"},
		},
		{
			name: "odd count takes the exact middle sample",
			samples: []*BenchmarkResult{
				sample(5000, "m"), sample(3000, "m"), sample(4000, "m"),
				sample(9000, "m"), sample(1000, "m"),
			},
			wantN:      5,
			wantMedian: 4000,
			wantSpread: 8000,
			wantModels: []string{"m"},
		},
		{
			name: "even count takes the upper-middle observed sample",
			samples: []*BenchmarkResult{
				sample(1000, "m"), sample(2000, "m"),
				sample(3000, "m"), sample(4000, "m"),
			},
			wantN:      4,
			wantMedian: 3000,
			wantSpread: 3000,
			wantModels: []string{"m"},
		},
		{
			name: "all-zero-cost samples still aggregate",
			samples: []*BenchmarkResult{
				sample(0, "m"), sample(0, "m"), sample(0, "m"),
			},
			wantN:      3,
			wantMedian: 0,
			wantSpread: 0,
			wantModels: []string{"m"},
		},
		{
			name: "nil samples are dropped before statistics",
			samples: []*BenchmarkResult{
				sample(2000, "m"), nil, sample(1000, "m"),
			},
			wantN:      2,
			wantMedian: 2000, // upper-middle of the two survivors
			wantSpread: 1000,
			wantModels: []string{"m"},
		},
		{
			name: "model drift across samples is detected",
			samples: []*BenchmarkResult{
				sample(1000, "grok-4.5-high"),
				sample(2000, "grok-4.5-high-fast"),
				sample(3000, "grok-4.5-high"),
			},
			wantN:          3,
			wantMedian:     2000,
			wantSpread:     2000,
			wantModels:     []string{"grok-4.5-high", "grok-4.5-high-fast"},
			wantModelDrift: true,
		},
		{
			name:           "cold call's model counts toward drift",
			samples:        []*BenchmarkResult{sample(1000, "m2"), sample(2000, "m2"), sample(3000, "m2")},
			cold:           sample(9000, "m1"),
			wantN:          3,
			wantMedian:     2000,
			wantSpread:     2000,
			wantModels:     []string{"m1", "m2"},
			wantModelDrift: true,
		},
		{
			name:       "unresolved (empty) model is skipped in the model list",
			samples:    []*BenchmarkResult{sample(1000, ""), sample(2000, "m")},
			wantN:      2,
			wantMedian: 2000,
			wantSpread: 1000,
			wantModels: []string{"m"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stat := NewBenchmarkStat(tt.samples, tt.cold)

			if tt.wantNil {
				assert.Nil(t, stat)
				return
			}
			require.NotNil(t, stat)

			assert.Equal(t, tt.wantN, stat.N, "sample count")
			require.NotNil(t, stat.Representative)
			assert.Equal(t, tt.wantMedian, stat.Representative.BillableCostMicros, "median billable")
			assert.Equal(t, tt.wantSpread, stat.BillableSpreadMicros, "spread")
			assert.Equal(t, tt.wantModels, stat.Models, "distinct models")
			assert.Equal(t, tt.wantModelDrift, stat.ModelDrift(), "model drift")
			assert.Equal(t, tt.cold, stat.ColdFirstCall, "cold first call carried through")
		})
	}
}

func TestNewBenchmarkStat_ColdNeverEntersStatistics(t *testing.T) {
	// The cold call is 12x the warm cost (the real-world shape). It must not
	// shift the median or the spread.
	cold := sample(45200, "m")
	warm := []*BenchmarkResult{sample(3700, "m"), sample(3700, "m"), sample(3800, "m")}

	stat := NewBenchmarkStat(warm, cold)
	require.NotNil(t, stat)

	assert.Equal(t, int64(3700), stat.Representative.BillableCostMicros)
	assert.Equal(t, int64(100), stat.BillableSpreadMicros)
	assert.Equal(t, cold, stat.ColdFirstCall)
}

func TestNewBenchmarkStat_MedianIsObservedSampleNotSynthetic(t *testing.T) {
	// The representative must be one of the input structs, so its token
	// buckets and cost are a combination that actually occurred together.
	a := &BenchmarkResult{BillableCostMicros: 1000, InputTokens: 10, Model: "m"}
	b := &BenchmarkResult{BillableCostMicros: 2000, InputTokens: 999, Model: "m"}
	c := &BenchmarkResult{BillableCostMicros: 3000, InputTokens: 30, Model: "m"}

	stat := NewBenchmarkStat([]*BenchmarkResult{c, a, b}, nil)
	require.NotNil(t, stat)

	assert.Same(t, b, stat.Representative)
}

func TestNewBenchmarkStat_DoesNotMutateInputOrder(t *testing.T) {
	first := sample(9000, "m")
	second := sample(1000, "m")
	third := sample(5000, "m")
	in := []*BenchmarkResult{first, second, third}

	stat := NewBenchmarkStat(in, nil)
	require.NotNil(t, stat)

	// Samples keep execution order; the sort for the median works on a copy.
	assert.Equal(t, []*BenchmarkResult{first, second, third}, stat.Samples)
	assert.Equal(t, []*BenchmarkResult{first, second, third}, in)
}

func TestCacheHitRatio(t *testing.T) {
	tests := []struct {
		name   string
		result BenchmarkResult
		want   float64
	}{
		{
			name: "warm call is dominated by cache reads",
			result: BenchmarkResult{
				InputTokens: 3, CacheReadTokens: 9997, CacheCreationTokens: 0,
				OutputTokens: 500, // must not enter the ratio
			},
			want: 0.9997,
		},
		{
			name: "cold call has zero hit ratio",
			result: BenchmarkResult{
				InputTokens: 3, CacheReadTokens: 0, CacheCreationTokens: 10000,
			},
			want: 0,
		},
		{
			name:   "no input-side tokens yields zero, not NaN",
			result: BenchmarkResult{OutputTokens: 42},
			want:   0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.InDelta(t, tt.want, tt.result.CacheHitRatio(), 1e-9)
		})
	}
}
