package root

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

// =============================================================================
// formatCost Tests
// =============================================================================

func TestFormatCost_Zero(t *testing.T) {
	if got := formatCost(0); got != "$0.00" {
		t.Errorf("formatCost(0) = %q, want $0.00", got)
	}
}

func TestFormatCost_SubCent(t *testing.T) {
	if got := formatCost(3000); got != "$0.003" {
		t.Errorf("formatCost(3000) = %q, want $0.003", got)
	}
}

func TestFormatCost_SubDollar(t *testing.T) {
	if got := formatCost(74000); got != "$0.074" {
		t.Errorf("formatCost(74000) = %q, want $0.074", got)
	}
}

func TestFormatCost_ExactlyOneDollar(t *testing.T) {
	if got := formatCost(1_000_000); got != "$1.00" {
		t.Errorf("formatCost(1_000_000) = %q, want $1.00", got)
	}
}

func TestFormatCost_MultipleDollars(t *testing.T) {
	if got := formatCost(18_420_000); got != "$18.42" {
		t.Errorf("formatCost(18_420_000) = %q, want $18.42", got)
	}
}

func TestFormatCost_LargeAmount(t *testing.T) {
	if got := formatCost(1_234_560_000); got != "$1234.56" {
		t.Errorf("formatCost(1_234_560_000) = %q, want $1234.56", got)
	}
}

// =============================================================================
// formatCacheHitRate Tests
// =============================================================================

func TestFormatCacheHitRate_NilUsage(t *testing.T) {
	if got := formatCacheHitRate(nil); got != "" {
		t.Errorf("formatCacheHitRate(nil) = %q, want empty", got)
	}
}

func TestFormatCacheHitRate_ZeroInputTokens(t *testing.T) {
	usage := &agentexecutionv1.UsageReportAggregate{InputTokens: 0, CacheReadInputTokens: 100}
	if got := formatCacheHitRate(usage); got != "" {
		t.Errorf("formatCacheHitRate(0 input) = %q, want empty", got)
	}
}

func TestFormatCacheHitRate_ZeroCacheTokens(t *testing.T) {
	usage := &agentexecutionv1.UsageReportAggregate{InputTokens: 10000, CacheReadInputTokens: 0}
	if got := formatCacheHitRate(usage); got != "" {
		t.Errorf("formatCacheHitRate(0 cache) = %q, want empty", got)
	}
}

func TestFormatCacheHitRate_TypicalRate(t *testing.T) {
	usage := &agentexecutionv1.UsageReportAggregate{InputTokens: 12450, CacheReadInputTokens: 10200}
	got := formatCacheHitRate(usage)
	if got != "82% cached" {
		t.Errorf("formatCacheHitRate(10200/12450) = %q, want '82%% cached'", got)
	}
}

func TestFormatCacheHitRate_FullCache(t *testing.T) {
	usage := &agentexecutionv1.UsageReportAggregate{InputTokens: 5000, CacheReadInputTokens: 5000}
	got := formatCacheHitRate(usage)
	if got != "100% cached" {
		t.Errorf("formatCacheHitRate(full) = %q, want '100%% cached'", got)
	}
}

// =============================================================================
// formatModelLabel Tests
// =============================================================================

func TestFormatModelLabel_NilUsage(t *testing.T) {
	if got := formatModelLabel(nil); got != "" {
		t.Errorf("formatModelLabel(nil) = %q, want empty", got)
	}
}

func TestFormatModelLabel_EmptyModel(t *testing.T) {
	usage := &agentexecutionv1.UsageReportAggregate{}
	if got := formatModelLabel(usage); got != "" {
		t.Errorf("formatModelLabel(empty) = %q, want empty", got)
	}
}

func TestFormatModelLabel_ModelOnly(t *testing.T) {
	usage := &agentexecutionv1.UsageReportAggregate{PrimaryModel: "claude-sonnet-4"}
	if got := formatModelLabel(usage); got != "claude-sonnet-4" {
		t.Errorf("formatModelLabel(model only) = %q, want 'claude-sonnet-4'", got)
	}
}

func TestFormatModelLabel_ModelAndProvider(t *testing.T) {
	usage := &agentexecutionv1.UsageReportAggregate{
		PrimaryModel:    "claude-sonnet-4",
		PrimaryProvider: "anthropic",
	}
	want := "claude-sonnet-4 (anthropic)"
	if got := formatModelLabel(usage); got != want {
		t.Errorf("formatModelLabel(both) = %q, want %q", got, want)
	}
}

// =============================================================================
// formatTokensCompact Tests
// =============================================================================

func TestFormatTokensCompact_Small(t *testing.T) {
	got := formatTokensCompact(500, 200)
	if got != "500 in, 200 out" {
		t.Errorf("formatTokensCompact(500, 200) = %q", got)
	}
}

func TestFormatTokensCompact_Thousands(t *testing.T) {
	got := formatTokensCompact(12500, 1830)
	if got != "12.5K in, 1.8K out" {
		t.Errorf("formatTokensCompact(12500, 1830) = %q", got)
	}
}

func TestFormatTokensCompact_Millions(t *testing.T) {
	got := formatTokensCompact(3245000, 420000)
	if got != "3.2M in, 420.0K out" {
		t.Errorf("formatTokensCompact(3245000, 420000) = %q", got)
	}
}

// =============================================================================
// formatCostLine Tests
// =============================================================================

func TestFormatCostLine_NilUsage(t *testing.T) {
	if got := formatCostLine(nil); got != "" {
		t.Errorf("formatCostLine(nil) = %q, want empty", got)
	}
}

func TestFormatCostLine_ZeroCost(t *testing.T) {
	usage := &agentexecutionv1.UsageReportAggregate{BillableCostMicros: 0}
	if got := formatCostLine(usage); got != "" {
		t.Errorf("formatCostLine(0) = %q, want empty", got)
	}
}

func TestFormatCostLine_CostWithoutCache(t *testing.T) {
	usage := &agentexecutionv1.UsageReportAggregate{
		BillableCostMicros:   74000,
		InputTokens:          12450,
		CacheReadInputTokens: 0,
	}
	if got := formatCostLine(usage); got != "$0.074" {
		t.Errorf("formatCostLine(no cache) = %q, want '$0.074'", got)
	}
}

func TestFormatCostLine_CostWithCache(t *testing.T) {
	usage := &agentexecutionv1.UsageReportAggregate{
		BillableCostMicros:   74000,
		InputTokens:          12450,
		CacheReadInputTokens: 10200,
	}
	want := "$0.074 (82% cached)"
	if got := formatCostLine(usage); got != want {
		t.Errorf("formatCostLine(with cache) = %q, want %q", got, want)
	}
}

// =============================================================================
// formatDate Tests
// =============================================================================

func TestFormatDate_Empty(t *testing.T) {
	if got := formatDate(""); got != "" {
		t.Errorf("formatDate('') = %q, want empty", got)
	}
}

func TestFormatDate_ValidRFC3339(t *testing.T) {
	got := formatDate("2026-03-10T14:30:00Z")
	if got != "Mar 10" {
		t.Errorf("formatDate(RFC3339) = %q, want 'Mar 10'", got)
	}
}

func TestFormatDate_InvalidFallsBackToPrefix(t *testing.T) {
	got := formatDate("2026-03-10")
	if got != "2026-03-10" {
		t.Errorf("formatDate(date-only) = %q, want '2026-03-10'", got)
	}
}

// =============================================================================
// formatDateRange Tests
// =============================================================================

func TestFormatDateRange_BothPresent(t *testing.T) {
	got := formatDateRange("2026-03-01T00:00:00Z", "2026-03-13T00:00:00Z")
	if got != "Mar 01 to Mar 13" {
		t.Errorf("formatDateRange(both) = %q, want 'Mar 01 to Mar 13'", got)
	}
}

func TestFormatDateRange_BothEmpty(t *testing.T) {
	if got := formatDateRange("", ""); got != "" {
		t.Errorf("formatDateRange(empty) = %q, want empty", got)
	}
}

// =============================================================================
// formatShare Tests
// =============================================================================

func TestFormatShare_Typical(t *testing.T) {
	if got := formatShare(4_020_000, 4_120_000); got != "97.6%" {
		t.Errorf("formatShare(4_020_000, 4_120_000) = %q, want '97.6%%'", got)
	}
}

func TestFormatShare_ZeroTotal(t *testing.T) {
	if got := formatShare(1_000_000, 0); got != "0.0%" {
		t.Errorf("formatShare(1_000_000, 0) = %q, want '0.0%%'", got)
	}
}
