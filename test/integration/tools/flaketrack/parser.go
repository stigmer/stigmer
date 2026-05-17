package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
)

// TestEvent represents a single event from gotestsum's JSON output (test2json format).
type TestEvent struct {
	Time    time.Time `json:"Time"`
	Action  string    `json:"Action"`
	Package string    `json:"Package"`
	Test    string    `json:"Test"`
	Elapsed float64   `json:"Elapsed"`
	Output  string    `json:"Output"`
}

// TestResult holds the aggregated result for a single test.
type TestResult struct {
	Name     string
	Package  string
	Passed   bool
	Skipped  bool
	Duration time.Duration
	Output   []string
}

// SuiteResults holds all parsed test results and derived metrics.
type SuiteResults struct {
	Tests      []TestResult
	TotalCount int
	PassCount  int
	FailCount  int
	SkipCount  int
	FlakeCount int
	Flakes     []string
	TotalTime  time.Duration
	Durations  []time.Duration
	RerunTests []string
}

// ParseTestJSON reads a gotestsum JSON output file and returns aggregated results.
func ParseTestJSON(path string) (*SuiteResults, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	type testState struct {
		pkg     string
		passed  bool
		skipped bool
		elapsed float64
		output  []string
	}

	tests := make(map[string]*testState)
	scanner := bufio.NewScanner(f)

	buf := make([]byte, 0, 256*1024)
	scanner.Buffer(buf, 2*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var ev TestEvent
		if err := json.Unmarshal(line, &ev); err != nil {
			continue
		}

		if ev.Test == "" {
			continue
		}

		key := ev.Package + "/" + ev.Test

		switch ev.Action {
		case "run":
			if tests[key] == nil {
				tests[key] = &testState{pkg: ev.Package}
			}
		case "pass":
			if tests[key] == nil {
				tests[key] = &testState{pkg: ev.Package}
			}
			tests[key].passed = true
			tests[key].elapsed = ev.Elapsed
		case "fail":
			if tests[key] == nil {
				tests[key] = &testState{pkg: ev.Package}
			}
			tests[key].passed = false
			tests[key].elapsed = ev.Elapsed
		case "skip":
			if tests[key] == nil {
				tests[key] = &testState{pkg: ev.Package}
			}
			tests[key].skipped = true
			tests[key].elapsed = ev.Elapsed
		case "output":
			if tests[key] == nil {
				tests[key] = &testState{pkg: ev.Package}
			}
			tests[key].output = append(tests[key].output, ev.Output)
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan %s: %w", path, err)
	}

	results := &SuiteResults{}
	for key, st := range tests {
		parts := strings.SplitN(key, "/", 2)
		name := ""
		if len(parts) == 2 {
			name = parts[1]
		}

		dur := time.Duration(st.elapsed * float64(time.Second))

		tr := TestResult{
			Name:     name,
			Package:  st.pkg,
			Passed:   st.passed,
			Skipped:  st.skipped,
			Duration: dur,
			Output:   st.output,
		}

		results.Tests = append(results.Tests, tr)

		if st.skipped {
			results.SkipCount++
		} else if st.passed {
			results.PassCount++
			results.Durations = append(results.Durations, dur)
		} else {
			results.FailCount++
			results.Durations = append(results.Durations, dur)
		}
	}

	results.TotalCount = len(results.Tests)

	sort.Slice(results.Durations, func(i, j int) bool {
		return results.Durations[i] < results.Durations[j]
	})

	for _, d := range results.Durations {
		results.TotalTime += d
	}

	return results, nil
}

// ParseRerunReport reads the gotestsum rerun report and returns the list of
// test names that were rerun (i.e., flaky tests that failed then passed).
func ParseRerunReport(path string) ([]string, error) {
	if path == "" {
		return nil, nil
	}

	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	var names []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		names = append(names, line)
	}
	return names, scanner.Err()
}

// Percentile returns the value at the given percentile (0-100) from a sorted slice.
func Percentile(sorted []time.Duration, pct float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(float64(len(sorted)-1) * pct / 100.0)
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}
