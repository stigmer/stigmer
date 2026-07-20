package harness

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

// BenchmarkReport is the top-level structure persisted to disk after each
// cost benchmark run. It captures environment context, per-scenario results,
// and summary statistics for historical trend analysis.
type BenchmarkReport struct {
	Timestamp   string                 `json:"timestamp"`
	GitSHA      string                 `json:"git_sha,omitempty"`
	Comparisons []*BenchmarkComparison `json:"comparisons"`
	Summary     BenchmarkSummary       `json:"summary"`
}

// BenchmarkSummary aggregates costs across all scenarios for quick comparison.
type BenchmarkSummary struct {
	TotalNativeCostMicros int64   `json:"total_native_cost_micros"`
	TotalCursorCostMicros int64   `json:"total_cursor_cost_micros"`
	OverallCostRatio      float64 `json:"overall_cost_ratio"`
	ScenarioCount         int     `json:"scenario_count"`
}

// BenchmarkTrend captures the delta between current and previous runs.
type BenchmarkTrend struct {
	PreviousTimestamp     string  `json:"previous_timestamp"`
	PreviousCostRatio     float64 `json:"previous_cost_ratio"`
	CurrentCostRatio      float64 `json:"current_cost_ratio"`
	CostRatioImprovement  float64 `json:"cost_ratio_improvement_pct"`
	NativeCostDeltaMicros int64   `json:"native_cost_delta_micros"`
}

const benchmarkReportDir = "benchmark-results"

// NewBenchmarkReport creates a report from a set of comparisons. Summary
// totals are computed from each cell's Representative (median-billable warm
// sample), so the overall cost ratio reflects steady state — cold first
// calls are reported per cell, never folded into the totals.
func NewBenchmarkReport(comparisons []*BenchmarkComparison, gitSHA string) *BenchmarkReport {
	report := &BenchmarkReport{
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		GitSHA:      gitSHA,
		Comparisons: comparisons,
	}

	var totalNative, totalCursor int64
	for _, c := range comparisons {
		if c == nil {
			continue
		}
		if c.Native != nil {
			totalNative += c.Native.Representative.BillableCostMicros
		}
		if c.Cursor != nil {
			totalCursor += c.Cursor.Representative.BillableCostMicros
		}
	}

	report.Summary = BenchmarkSummary{
		TotalNativeCostMicros: totalNative,
		TotalCursorCostMicros: totalCursor,
		ScenarioCount:         len(comparisons),
	}
	if totalCursor > 0 {
		report.Summary.OverallCostRatio = float64(totalNative) / float64(totalCursor)
	}

	return report
}

// WriteBenchmarkReport persists the report as timestamped JSON under outputDir.
func WriteBenchmarkReport(outputDir string, report *BenchmarkReport) (string, error) {
	dir := filepath.Join(outputDir, benchmarkReportDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create benchmark report directory: %w", err)
	}

	ts := time.Now().UTC().Format("2006-01-02-150405")
	filename := fmt.Sprintf("%s.json", ts)
	path := filepath.Join(dir, filename)

	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal benchmark report: %w", err)
	}

	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", fmt.Errorf("write benchmark report: %w", err)
	}

	return path, nil
}

// LoadPreviousReport loads the most recent benchmark report from outputDir.
// Returns nil if no previous reports exist.
func LoadPreviousReport(outputDir string) (*BenchmarkReport, error) {
	dir := filepath.Join(outputDir, benchmarkReportDir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read benchmark report directory: %w", err)
	}

	var jsonFiles []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".json" {
			jsonFiles = append(jsonFiles, filepath.Join(dir, e.Name()))
		}
	}

	if len(jsonFiles) == 0 {
		return nil, nil
	}

	sort.Strings(jsonFiles)
	// Most recent is last (filenames are timestamp-sorted)
	latestPath := jsonFiles[len(jsonFiles)-1]

	data, err := os.ReadFile(latestPath)
	if err != nil {
		return nil, fmt.Errorf("read previous report %s: %w", latestPath, err)
	}

	var report BenchmarkReport
	if err := json.Unmarshal(data, &report); err != nil {
		return nil, fmt.Errorf("parse previous report %s: %w", latestPath, err)
	}

	return &report, nil
}

// ComputeTrend compares the current report against a previous one and returns
// improvement metrics. Returns nil if previous is nil.
func ComputeTrend(current, previous *BenchmarkReport) *BenchmarkTrend {
	if previous == nil {
		return nil
	}

	trend := &BenchmarkTrend{
		PreviousTimestamp: previous.Timestamp,
		PreviousCostRatio: previous.Summary.OverallCostRatio,
		CurrentCostRatio:  current.Summary.OverallCostRatio,
	}

	if previous.Summary.OverallCostRatio > 0 {
		// Positive improvement means cost ratio decreased (native got cheaper relative to cursor)
		trend.CostRatioImprovement = (previous.Summary.OverallCostRatio - current.Summary.OverallCostRatio) / previous.Summary.OverallCostRatio * 100
	}

	trend.NativeCostDeltaMicros = current.Summary.TotalNativeCostMicros - previous.Summary.TotalNativeCostMicros

	return trend
}

// LogTrend logs the trend comparison to the test output.
func LogTrend(t *testing.T, trend *BenchmarkTrend) {
	t.Helper()

	if trend == nil {
		t.Logf("  [trend] No previous benchmark data — this is the baseline run.")
		return
	}

	t.Logf("")
	t.Logf("═══ TREND vs PREVIOUS RUN (%s) ═══", trend.PreviousTimestamp)
	t.Logf("  Previous cost ratio: %.2fx", trend.PreviousCostRatio)
	t.Logf("  Current cost ratio:  %.2fx", trend.CurrentCostRatio)

	if trend.CostRatioImprovement > 0 {
		t.Logf("  Improvement:         %.1f%% (native cost ratio decreased)", trend.CostRatioImprovement)
	} else if trend.CostRatioImprovement < 0 {
		t.Logf("  Regression:          %.1f%% (native cost ratio increased)", -trend.CostRatioImprovement)
	} else {
		t.Logf("  Change:              none")
	}

	if trend.NativeCostDeltaMicros != 0 {
		t.Logf("  Native cost delta:   %+d micros ($%+.4f)",
			trend.NativeCostDeltaMicros, float64(trend.NativeCostDeltaMicros)/1_000_000)
	}
	t.Logf("")
}

// CursorModeReport is the top-level structure persisted to disk after each
// cursor local-vs-cloud benchmark run.
type CursorModeReport struct {
	Timestamp   string                  `json:"timestamp"`
	GitSHA      string                  `json:"git_sha,omitempty"`
	Comparisons []*CursorModeComparison `json:"comparisons"`
	Summary     CursorModeSummary       `json:"summary"`
}

// CursorModeSummary aggregates cursor mode comparison results.
type CursorModeSummary struct {
	ScenarioCount   int     `json:"scenario_count"`
	AvgLatencyRatio float64 `json:"avg_latency_ratio"`
	AvgTokenDelta   int64   `json:"avg_token_delta"`
	ModelMatchCount int     `json:"model_match_count"`
}

const cursorModeReportDir = "cursor-mode-results"

// NewCursorModeReport creates a report from a set of cursor mode comparisons.
func NewCursorModeReport(comparisons []*CursorModeComparison, gitSHA string) *CursorModeReport {
	report := &CursorModeReport{
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		GitSHA:      gitSHA,
		Comparisons: comparisons,
	}

	var totalLatencyRatio float64
	var totalTokenDelta int64
	var modelMatches int
	validCount := 0

	for _, c := range comparisons {
		if c == nil {
			continue
		}
		validCount++
		totalLatencyRatio += c.LatencyRatio
		totalTokenDelta += c.TokenDelta
		if c.ModelMatch {
			modelMatches++
		}
	}

	report.Summary = CursorModeSummary{
		ScenarioCount:   len(comparisons),
		ModelMatchCount: modelMatches,
	}
	if validCount > 0 {
		report.Summary.AvgLatencyRatio = totalLatencyRatio / float64(validCount)
		report.Summary.AvgTokenDelta = totalTokenDelta / int64(validCount)
	}

	return report
}

// WriteCursorModeReport persists the cursor mode report as timestamped JSON.
func WriteCursorModeReport(outputDir string, report *CursorModeReport) (string, error) {
	dir := filepath.Join(outputDir, cursorModeReportDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create cursor mode report directory: %w", err)
	}

	ts := time.Now().UTC().Format("2006-01-02-150405")
	filename := fmt.Sprintf("%s.json", ts)
	path := filepath.Join(dir, filename)

	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal cursor mode report: %w", err)
	}

	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", fmt.Errorf("write cursor mode report: %w", err)
	}

	return path, nil
}

// GetGitSHA attempts to read the current git HEAD SHA. Returns empty string
// on failure (non-critical for benchmarking).
func GetGitSHA() string {
	// Read from .git/HEAD if available
	data, err := os.ReadFile(".git/HEAD")
	if err != nil {
		// Try relative to test directory
		data, err = os.ReadFile("../../.git/HEAD")
		if err != nil {
			return ""
		}
	}

	head := string(data)
	if len(head) > 5 && head[:5] == "ref: " {
		// Resolve the ref
		refPath := head[5 : len(head)-1] // strip "ref: " and newline
		refData, refErr := os.ReadFile(filepath.Join("../../.git", refPath))
		if refErr != nil {
			refData, refErr = os.ReadFile(filepath.Join(".git", refPath))
			if refErr != nil {
				return ""
			}
		}
		sha := string(refData)
		if len(sha) >= 12 {
			return sha[:12]
		}
		return sha
	}

	// Detached HEAD — content is the SHA directly
	if len(head) >= 12 {
		return head[:12]
	}
	return head
}
