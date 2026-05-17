package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

func runReport(args []string) error {
	fs := flag.NewFlagSet("report", flag.ExitOnError)
	jsonPath := fs.String("json", "", "gotestsum JSON output file (required)")
	rerunPath := fs.String("rerun-report", "", "gotestsum rerun report file")
	quarantinePath := fs.String("quarantine", "", "quarantine.json file")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if *jsonPath == "" {
		return fmt.Errorf("--json is required")
	}

	results, err := ParseTestJSON(*jsonPath)
	if err != nil {
		return fmt.Errorf("parse test JSON: %w", err)
	}

	rerunTests, err := ParseRerunReport(*rerunPath)
	if err != nil {
		return fmt.Errorf("parse rerun report: %w", err)
	}
	results.RerunTests = rerunTests
	results.FlakeCount = len(rerunTests)
	results.Flakes = rerunTests

	qf, err := LoadQuarantine(*quarantinePath)
	if err != nil {
		return fmt.Errorf("load quarantine: %w", err)
	}

	return writeReport(os.Stdout, results, qf)
}

func writeReport(w io.Writer, results *SuiteResults, qf *QuarantineFile) error {
	nonSkipped := results.TotalCount - results.SkipCount
	firstPassRate := 100.0
	if nonSkipped > 0 {
		firstPassRate = float64(nonSkipped-results.FlakeCount-results.FailCount) / float64(nonSkipped) * 100
	}

	fmt.Fprintln(w, "## Integration Test Health Report")
	fmt.Fprintln(w)

	statusIcon := "pass"
	if results.FailCount > 0 {
		statusIcon = "FAIL"
	} else if results.FlakeCount > 0 {
		statusIcon = "flaky"
	}

	fmt.Fprintf(w, "**Status**: %s | **First-pass rate**: %.1f%%\n\n", statusIcon, firstPassRate)

	fmt.Fprintln(w, "### Summary")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "| Metric | Value |")
	fmt.Fprintln(w, "|--------|-------|")
	fmt.Fprintf(w, "| Total tests | %d |\n", results.TotalCount)
	fmt.Fprintf(w, "| Passed | %d |\n", results.PassCount)
	fmt.Fprintf(w, "| Failed | %d |\n", results.FailCount)
	fmt.Fprintf(w, "| Skipped | %d |\n", results.SkipCount)
	fmt.Fprintf(w, "| Flaky (passed on rerun) | %d |\n", results.FlakeCount)
	fmt.Fprintf(w, "| First-pass rate | %.1f%% |\n", firstPassRate)
	fmt.Fprintln(w)

	if len(results.Durations) > 0 {
		fmt.Fprintln(w, "### Duration Percentiles")
		fmt.Fprintln(w)
		fmt.Fprintln(w, "| Percentile | Duration |")
		fmt.Fprintln(w, "|------------|----------|")
		fmt.Fprintf(w, "| p50 | %s |\n", formatDuration(Percentile(results.Durations, 50)))
		fmt.Fprintf(w, "| p90 | %s |\n", formatDuration(Percentile(results.Durations, 90)))
		fmt.Fprintf(w, "| p95 | %s |\n", formatDuration(Percentile(results.Durations, 95)))
		fmt.Fprintf(w, "| p99 | %s |\n", formatDuration(Percentile(results.Durations, 99)))
		fmt.Fprintf(w, "| Total | %s |\n", formatDuration(results.TotalTime))
		fmt.Fprintln(w)
	}

	if len(results.Flakes) > 0 {
		fmt.Fprintln(w, "### Flaky Tests (Passed on Rerun)")
		fmt.Fprintln(w)
		fmt.Fprintln(w, "These tests failed on the first attempt but passed when rerun.")
		fmt.Fprintln(w, "Consider investigating root causes or quarantining persistent offenders.")
		fmt.Fprintln(w)
		fmt.Fprintln(w, "| Test |")
		fmt.Fprintln(w, "|------|")
		for _, name := range results.Flakes {
			fmt.Fprintf(w, "| `%s` |\n", name)
		}
		fmt.Fprintln(w)
	}

	if len(results.Tests) > 0 {
		var failed []TestResult
		for _, t := range results.Tests {
			if !t.Passed && !t.Skipped {
				rerun := false
				for _, rn := range results.Flakes {
					if strings.Contains(rn, t.Name) {
						rerun = true
						break
					}
				}
				if !rerun {
					failed = append(failed, t)
				}
			}
		}
		if len(failed) > 0 {
			fmt.Fprintln(w, "### Failed Tests")
			fmt.Fprintln(w)
			fmt.Fprintln(w, "| Test | Duration |")
			fmt.Fprintln(w, "|------|----------|")
			for _, t := range failed {
				fmt.Fprintf(w, "| `%s` | %s |\n", t.Name, formatDuration(t.Duration))
			}
			fmt.Fprintln(w)
		}
	}

	if len(qf.Quarantined) > 0 {
		fmt.Fprintln(w, "### Quarantine Status")
		fmt.Fprintln(w)
		fmt.Fprintln(w, "| Test | Reason | Expires | Status |")
		fmt.Fprintln(w, "|------|--------|---------|--------|")

		now := time.Now()
		for _, entry := range qf.Quarantined {
			status := "quarantined"
			exp, err := time.Parse("2006-01-02", entry.Expires)
			if err == nil && now.After(exp) {
				status = "EXPIRED"
			}
			fmt.Fprintf(w, "| `%s` | %s | %s | %s |\n",
				entry.Test, entry.Reason, entry.Expires, status)
		}
		fmt.Fprintln(w)

		expired := qf.ExpiredEntries(now)
		if len(expired) > 0 {
			fmt.Fprintf(w, "> **Warning**: %d quarantine entries have expired. "+
				"Investigate and either fix the root cause or extend the expiry.\n\n", len(expired))
		}
	}

	return nil
}

func formatDuration(d time.Duration) string {
	if d < time.Second {
		return fmt.Sprintf("%dms", d.Milliseconds())
	}
	return fmt.Sprintf("%.1fs", d.Seconds())
}
