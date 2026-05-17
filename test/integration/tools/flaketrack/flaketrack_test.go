package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseTestJSON(t *testing.T) {
	content := `{"Time":"2026-05-16T15:00:00Z","Action":"run","Package":"pkg","Test":"TestA"}
{"Time":"2026-05-16T15:00:01Z","Action":"pass","Package":"pkg","Test":"TestA","Elapsed":1.5}
{"Time":"2026-05-16T15:00:01Z","Action":"run","Package":"pkg","Test":"TestB"}
{"Time":"2026-05-16T15:00:03Z","Action":"fail","Package":"pkg","Test":"TestB","Elapsed":2.0}
{"Time":"2026-05-16T15:00:03Z","Action":"run","Package":"pkg","Test":"TestC"}
{"Time":"2026-05-16T15:00:03Z","Action":"skip","Package":"pkg","Test":"TestC","Elapsed":0.01}
`
	path := writeTemp(t, "test-output.json", content)

	results, err := ParseTestJSON(path)
	if err != nil {
		t.Fatalf("ParseTestJSON: %v", err)
	}

	if results.TotalCount != 3 {
		t.Errorf("TotalCount = %d, want 3", results.TotalCount)
	}
	if results.PassCount != 1 {
		t.Errorf("PassCount = %d, want 1", results.PassCount)
	}
	if results.FailCount != 1 {
		t.Errorf("FailCount = %d, want 1", results.FailCount)
	}
	if results.SkipCount != 1 {
		t.Errorf("SkipCount = %d, want 1", results.SkipCount)
	}
}

func TestParseTestJSON_EmptyFile(t *testing.T) {
	path := writeTemp(t, "empty.json", "")

	results, err := ParseTestJSON(path)
	if err != nil {
		t.Fatalf("ParseTestJSON: %v", err)
	}
	if results.TotalCount != 0 {
		t.Errorf("TotalCount = %d, want 0", results.TotalCount)
	}
}

func TestParseTestJSON_PackageLevelEvents(t *testing.T) {
	content := `{"Time":"2026-05-16T15:00:00Z","Action":"output","Package":"pkg","Output":"=== RUN\n"}
{"Time":"2026-05-16T15:00:00Z","Action":"run","Package":"pkg","Test":"TestA"}
{"Time":"2026-05-16T15:00:01Z","Action":"pass","Package":"pkg","Test":"TestA","Elapsed":0.5}
{"Time":"2026-05-16T15:00:01Z","Action":"pass","Package":"pkg","Elapsed":0.6}
`
	path := writeTemp(t, "pkg-events.json", content)

	results, err := ParseTestJSON(path)
	if err != nil {
		t.Fatalf("ParseTestJSON: %v", err)
	}
	if results.TotalCount != 1 {
		t.Errorf("TotalCount = %d, want 1 (package-level events excluded)", results.TotalCount)
	}
}

func TestParseRerunReport(t *testing.T) {
	content := "TestA/subtest\nTestB\n"
	path := writeTemp(t, "rerun.txt", content)

	names, err := ParseRerunReport(path)
	if err != nil {
		t.Fatalf("ParseRerunReport: %v", err)
	}
	if len(names) != 2 {
		t.Fatalf("len(names) = %d, want 2", len(names))
	}
	if names[0] != "TestA/subtest" {
		t.Errorf("names[0] = %q, want TestA/subtest", names[0])
	}
}

func TestParseRerunReport_Missing(t *testing.T) {
	names, err := ParseRerunReport("/nonexistent/path")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if names != nil {
		t.Errorf("expected nil, got %v", names)
	}
}

func TestParseRerunReport_Empty(t *testing.T) {
	names, err := ParseRerunReport("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if names != nil {
		t.Errorf("expected nil, got %v", names)
	}
}

func TestLoadQuarantine(t *testing.T) {
	content := `{
  "quarantined": [
    {"test": "TestFlaky", "reason": "timing", "issue": "http://example.com", "added": "2026-05-01", "expires": "2026-06-01"}
  ]
}`
	path := writeTemp(t, "quarantine.json", content)

	qf, err := LoadQuarantine(path)
	if err != nil {
		t.Fatalf("LoadQuarantine: %v", err)
	}
	if len(qf.Quarantined) != 1 {
		t.Fatalf("len(Quarantined) = %d, want 1", len(qf.Quarantined))
	}
	if qf.Quarantined[0].Test != "TestFlaky" {
		t.Errorf("Test = %q, want TestFlaky", qf.Quarantined[0].Test)
	}
}

func TestLoadQuarantine_Missing(t *testing.T) {
	qf, err := LoadQuarantine("/nonexistent/quarantine.json")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(qf.Quarantined) != 0 {
		t.Errorf("expected empty quarantine, got %d entries", len(qf.Quarantined))
	}
}

func TestLoadQuarantine_Empty(t *testing.T) {
	qf, err := LoadQuarantine("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if qf == nil {
		t.Fatal("expected non-nil QuarantineFile")
	}
}

func TestExpiredEntries(t *testing.T) {
	qf := &QuarantineFile{
		Quarantined: []QuarantineEntry{
			{Test: "TestExpired", Expires: "2026-01-01"},
			{Test: "TestActive", Expires: "2099-12-31"},
			{Test: "TestNoExpiry", Expires: ""},
		},
	}

	expired := qf.ExpiredEntries(time.Date(2026, 5, 16, 0, 0, 0, 0, time.UTC))
	if len(expired) != 1 {
		t.Fatalf("len(expired) = %d, want 1", len(expired))
	}
	if expired[0].Test != "TestExpired" {
		t.Errorf("expired[0].Test = %q, want TestExpired", expired[0].Test)
	}
}

func TestPercentile(t *testing.T) {
	durations := []time.Duration{
		100 * time.Millisecond,
		200 * time.Millisecond,
		300 * time.Millisecond,
		400 * time.Millisecond,
		500 * time.Millisecond,
	}

	if got := Percentile(durations, 0); got != 100*time.Millisecond {
		t.Errorf("p0 = %v, want 100ms", got)
	}
	if got := Percentile(durations, 50); got != 300*time.Millisecond {
		t.Errorf("p50 = %v, want 300ms", got)
	}
	if got := Percentile(durations, 100); got != 500*time.Millisecond {
		t.Errorf("p100 = %v, want 500ms", got)
	}
	if got := Percentile(nil, 50); got != 0 {
		t.Errorf("empty p50 = %v, want 0", got)
	}
}

func TestWriteReport_AllPassing(t *testing.T) {
	results := &SuiteResults{
		TotalCount: 10,
		PassCount:  8,
		SkipCount:  2,
		Durations: []time.Duration{
			100 * time.Millisecond,
			500 * time.Millisecond,
			1 * time.Second,
		},
		TotalTime: 1600 * time.Millisecond,
	}
	qf := &QuarantineFile{}

	var buf bytes.Buffer
	if err := writeReport(&buf, results, qf); err != nil {
		t.Fatalf("writeReport: %v", err)
	}

	output := buf.String()
	if !strings.Contains(output, "First-pass rate**: 100.0%") {
		t.Errorf("expected 100%% first-pass rate in output:\n%s", output)
	}
	if strings.Contains(output, "Flaky Tests") {
		t.Error("should not contain Flaky Tests section when no flakes")
	}
	if strings.Contains(output, "Quarantine Status") {
		t.Error("should not contain Quarantine Status when quarantine is empty")
	}
}

func TestWriteReport_WithFlakes(t *testing.T) {
	results := &SuiteResults{
		TotalCount: 5,
		PassCount:  4,
		FailCount:  0,
		SkipCount:  0,
		FlakeCount: 1,
		Flakes:     []string{"TestUnstable/subtest"},
		Durations:  []time.Duration{500 * time.Millisecond},
		TotalTime:  500 * time.Millisecond,
	}
	qf := &QuarantineFile{}

	var buf bytes.Buffer
	if err := writeReport(&buf, results, qf); err != nil {
		t.Fatalf("writeReport: %v", err)
	}

	output := buf.String()
	if !strings.Contains(output, "flaky") {
		t.Errorf("expected 'flaky' status in output:\n%s", output)
	}
	if !strings.Contains(output, "TestUnstable/subtest") {
		t.Errorf("expected flake test name in output:\n%s", output)
	}
}

func TestWriteReport_WithExpiredQuarantine(t *testing.T) {
	results := &SuiteResults{
		TotalCount: 1,
		PassCount:  1,
		Durations:  []time.Duration{100 * time.Millisecond},
		TotalTime:  100 * time.Millisecond,
	}
	qf := &QuarantineFile{
		Quarantined: []QuarantineEntry{
			{Test: "TestOld", Reason: "ancient flake", Expires: "2025-01-01"},
		},
	}

	var buf bytes.Buffer
	if err := writeReport(&buf, results, qf); err != nil {
		t.Fatalf("writeReport: %v", err)
	}

	output := buf.String()
	if !strings.Contains(output, "EXPIRED") {
		t.Errorf("expected EXPIRED in quarantine status:\n%s", output)
	}
	if !strings.Contains(output, "Warning") {
		t.Errorf("expected expiry warning:\n%s", output)
	}
}

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		d    time.Duration
		want string
	}{
		{500 * time.Millisecond, "500ms"},
		{1500 * time.Millisecond, "1.5s"},
		{0, "0ms"},
		{10 * time.Second, "10.0s"},
	}

	for _, tc := range tests {
		got := formatDuration(tc.d)
		if got != tc.want {
			t.Errorf("formatDuration(%v) = %q, want %q", tc.d, got, tc.want)
		}
	}
}

func writeTemp(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write temp file: %v", err)
	}
	return path
}
