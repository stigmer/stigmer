package logs

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

// MergeLogFilesWithPreferences reads multiple log files using smart stream preferences.
// Each component can specify whether it prefers stderr or stdout.
func MergeLogFilesWithPreferences(components []ComponentConfig, tailLines int) ([]LogLine, error) {
	var allLines []LogLine

	for _, comp := range components {
		logFile := comp.LogFile
		if comp.PreferStderr {
			logFile = comp.ErrFile
		}

		if _, err := os.Stat(logFile); os.IsNotExist(err) {
			continue
		}

		lines, err := readLogFile(logFile, comp.Name, tailLines)
		if err != nil {
			return nil, fmt.Errorf("failed to read %s logs: %w", comp.Name, err)
		}

		allLines = append(allLines, lines...)
	}

	sort.Slice(allLines, func(i, j int) bool {
		return allLines[i].Timestamp.Before(allLines[j].Timestamp)
	})

	if tailLines > 0 && len(allLines) > tailLines {
		allLines = allLines[len(allLines)-tailLines:]
	}

	return allLines, nil
}

// readLogFile reads a log file and returns parsed log lines
func readLogFile(logFile, component string, tailLines int) ([]LogLine, error) {
	file, err := os.Open(logFile)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var lines []LogLine
	scanner := bufio.NewScanner(file)

	if tailLines == 0 {
		for scanner.Scan() {
			line := scanner.Text()
			logLine := ParseLogLine(line, component)
			lines = append(lines, logLine)
		}
	} else {
		buffer := make([]string, 0, tailLines*2)
		for scanner.Scan() {
			line := scanner.Text()
			buffer = append(buffer, line)
			if len(buffer) > tailLines*2 {
				buffer = buffer[len(buffer)-tailLines:]
			}
		}

		for _, line := range buffer {
			logLine := ParseLogLine(line, component)
			lines = append(lines, logLine)
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return lines, nil
}

// PrintMergedLogs prints merged log lines to stdout
func PrintMergedLogs(lines []LogLine) {
	for _, line := range lines {
		fmt.Println(FormatLogLine(line))
	}
}
