package harness

// Statistical aggregation for cost benchmark cells (scenario × harness).
//
// The benchmark's publishable numbers must survive run-to-run variance and
// prompt-cache state. Two methodology rules are encoded here rather than
// left to the caller:
//
//  1. Cold/warm separation. The first call to a cell pays a prompt-cache
//     WRITE (measured ~12x the warm cost on native), so averaging cold and
//     warm samples produces a meaningless number. The cold first call is
//     kept as its own figure (ColdFirstCall) and never enters the
//     steady-state statistics.
//
//  2. Real-sample median. The representative run is the actual observed
//     sample at the median billable cost — never a synthetic record
//     stitched from per-field medians, which would report a token/cost
//     combination that no real execution produced. Callers should prefer
//     odd N so the median is a single sample with no ambiguity; for even N
//     the upper-middle sample is taken.
//
// This file is deliberately stdlib-only (no gRPC, no testing) so the
// statistics are unit-testable without harness processes or API keys.

import "sort"

// BenchmarkStat aggregates repeated warm-state measurements of one benchmark
// cell, plus the cold first call that warmed the cache. It is the per-cell
// unit of the persisted benchmark report and the data contract consumed by
// the docs-site comparison generator.
type BenchmarkStat struct {
	// N is the number of warm measured samples (excludes ColdFirstCall).
	N int `json:"n"`

	// Samples are the warm measured runs, in execution order.
	Samples []*BenchmarkResult `json:"samples"`

	// Representative is the observed sample at the median billable cost.
	// Summary and ratio math read this field, never a per-field synthesis.
	Representative *BenchmarkResult `json:"representative"`

	// BillableSpreadMicros is max−min billable cost across Samples — the
	// honesty figure published alongside the median.
	BillableSpreadMicros int64 `json:"billable_spread_micros"`

	// CacheHitRatio is the Representative's cache-read share of all
	// input-side tokens (see BenchmarkResult.CacheHitRatio).
	CacheHitRatio float64 `json:"cache_hit_ratio"`

	// Models lists the distinct resolved models observed across the cold
	// call and all samples, in first-seen order. More than one entry means
	// the provider re-routed mid-cell and the cell is not apples-to-apples.
	Models []string `json:"models"`

	// ColdFirstCall is the discarded warmup run that paid the cache write.
	// It is real money a customer pays on their first call, so reports
	// publish it as a separate "first call" figure. Nil when the caller
	// measured without a warmup (e.g. single-shot comparisons).
	ColdFirstCall *BenchmarkResult `json:"cold_first_call,omitempty"`
}

// NewBenchmarkStat folds warm samples (and an optional cold first call) into
// a BenchmarkStat. Nil samples — failed executions — are dropped. Returns
// nil when no valid samples remain, mirroring how a nil BenchmarkResult
// already signals "this harness produced nothing to compare".
func NewBenchmarkStat(samples []*BenchmarkResult, cold *BenchmarkResult) *BenchmarkStat {
	valid := make([]*BenchmarkResult, 0, len(samples))
	for _, s := range samples {
		if s != nil {
			valid = append(valid, s)
		}
	}
	if len(valid) == 0 {
		return nil
	}

	rep := medianByBillable(valid)

	return &BenchmarkStat{
		N:                    len(valid),
		Samples:              valid,
		Representative:       rep,
		BillableSpreadMicros: billableSpread(valid),
		CacheHitRatio:        rep.CacheHitRatio(),
		Models:               distinctModels(cold, valid),
		ColdFirstCall:        cold,
	}
}

// ModelDrift reports whether the provider resolved more than one model
// across the cell's executions (e.g. Cursor auto-routing changed mid-run).
// A drifted cell's numbers mix models and must be annotated, not averaged.
func (s *BenchmarkStat) ModelDrift() bool {
	return len(s.Models) > 1
}

// CacheHitRatio is the share of input-side tokens served from prompt cache:
// cache_read / (input + cache_read + cache_write). Output tokens are
// excluded — caching only ever applies to the prompt side. Returns 0 when
// no input-side tokens were recorded.
func (r *BenchmarkResult) CacheHitRatio() float64 {
	inputSide := r.InputTokens + r.CacheReadTokens + r.CacheCreationTokens
	if inputSide == 0 {
		return 0
	}
	return float64(r.CacheReadTokens) / float64(inputSide)
}

// medianByBillable returns the observed sample at the median billable cost.
// For even counts the upper-middle sample is taken — still a real run, never
// an interpolation. The input slice is not mutated.
func medianByBillable(samples []*BenchmarkResult) *BenchmarkResult {
	sorted := make([]*BenchmarkResult, len(samples))
	copy(sorted, samples)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].BillableCostMicros < sorted[j].BillableCostMicros
	})
	return sorted[len(sorted)/2]
}

// billableSpread returns max−min billable cost across the samples.
func billableSpread(samples []*BenchmarkResult) int64 {
	min, max := samples[0].BillableCostMicros, samples[0].BillableCostMicros
	for _, s := range samples[1:] {
		if s.BillableCostMicros < min {
			min = s.BillableCostMicros
		}
		if s.BillableCostMicros > max {
			max = s.BillableCostMicros
		}
	}
	return max - min
}

// distinctModels collects resolved models across the cold call and samples
// in first-seen order, skipping empties (a run whose model never resolved).
func distinctModels(cold *BenchmarkResult, samples []*BenchmarkResult) []string {
	seen := make(map[string]bool)
	var models []string
	record := func(r *BenchmarkResult) {
		if r == nil || r.Model == "" || seen[r.Model] {
			return
		}
		seen[r.Model] = true
		models = append(models, r.Model)
	}
	record(cold)
	for _, s := range samples {
		record(s)
	}
	return models
}
