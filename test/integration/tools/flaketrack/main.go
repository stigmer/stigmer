package main

import (
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "report":
		if err := runReport(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
	case "help", "-h", "--help":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Fprintln(os.Stderr, `flaketrack — integration test health reporting

Usage:
  flaketrack report [flags]    Generate a markdown health report

Flags (report):
  --json <path>            gotestsum JSON output file (required)
  --rerun-report <path>    gotestsum rerun report file (optional)
  --quarantine <path>      quarantine.json file (optional)

The report is written to stdout as GitHub Flavored Markdown, suitable for
piping to $GITHUB_STEP_SUMMARY or local inspection.`)
}
