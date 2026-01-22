package logs

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
)

// MergeLogFiles reads multiple log files and returns merged, sorted log lines
func MergeLogFiles(components []ComponentConfig, showStderr bool, tailLines int) ([]LogLine, error) {
	var allLines []LogLine

	for _, comp := range components {
		var lines []LogLine
		var err error

		// Docker container takes precedence
		if comp.DockerContainer != "" {
			lines, err = readDockerLogs(comp.DockerContainer, comp.Name, tailLines)
			if err != nil {
				return nil, fmt.Errorf("failed to read %s Docker logs: %w", comp.Name, err)
			}
		} else {
			// File-based logging
			logFile := comp.LogFile
			if showStderr {
				logFile = comp.ErrFile
			}

			// Check if file exists
			if _, err := os.Stat(logFile); os.IsNotExist(err) {
				continue // Skip non-existent files
			}

			// Read lines from file
			lines, err = readLogFile(logFile, comp.Name, tailLines)
			if err != nil {
				return nil, fmt.Errorf("failed to read %s logs: %w", comp.Name, err)
			}
		}

		allLines = append(allLines, lines...)
	}

	// Sort by timestamp
	sort.Slice(allLines, func(i, j int) bool {
		return allLines[i].Timestamp.Before(allLines[j].Timestamp)
	})

	// Apply tail limit to merged results
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
		// Read all lines
		for scanner.Scan() {
			line := scanner.Text()
			logLine := ParseLogLine(line, component)
			lines = append(lines, logLine)
		}
	} else {
		// Use circular buffer for tail
		buffer := make([]string, 0, tailLines*2) // Double size to avoid frequent resizing
		for scanner.Scan() {
			line := scanner.Text()
			buffer = append(buffer, line)
			if len(buffer) > tailLines*2 {
				// Keep only the last tailLines*2 entries
				buffer = buffer[len(buffer)-tailLines:]
			}
		}

		// Parse collected lines
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

// readDockerLogs reads logs from a Docker container and returns parsed log lines
func readDockerLogs(containerName, component string, tailLines int) ([]LogLine, error) {
	args := []string{"logs"}
	
	if tailLines > 0 {
		args = append(args, "--tail", strconv.Itoa(tailLines))
	}
	
	args = append(args, containerName)
	
	cmd := exec.Command("docker", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to read Docker logs: %w", err)
	}
	
	// Parse output lines
	var lines []LogLine
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	for scanner.Scan() {
		line := scanner.Text()
		logLine := ParseLogLine(line, component)
		lines = append(lines, logLine)
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

// MergeLogFilesWithPreferences reads multiple log files using smart stream preferences
// Each component can specify whether it prefers stderr or stdout
func MergeLogFilesWithPreferences(components []ComponentConfig, tailLines int) ([]LogLine, error) {
	var allLines []LogLine

	for _, comp := range components {
		var lines []LogLine
		var err error

		// Docker container takes precedence
		if comp.DockerContainer != "" {
			lines, err = readDockerLogs(comp.DockerContainer, comp.Name, tailLines)
			if err != nil {
				return nil, fmt.Errorf("failed to read %s Docker logs: %w", comp.Name, err)
			}
		} else {
			// File-based logging - use PreferStderr to choose stream
			logFile := comp.LogFile
			if comp.PreferStderr {
				logFile = comp.ErrFile
			}

			// Check if file exists
			if _, err := os.Stat(logFile); os.IsNotExist(err) {
				continue // Skip non-existent files
			}

			// Read lines from file
			lines, err = readLogFile(logFile, comp.Name, tailLines)
			if err != nil {
				return nil, fmt.Errorf("failed to read %s logs: %w", comp.Name, err)
			}
		}

		allLines = append(allLines, lines...)
	}

	// Sort by timestamp
	sort.Slice(allLines, func(i, j int) bool {
		return allLines[i].Timestamp.Before(allLines[j].Timestamp)
	})

	// Apply tail limit to merged results
	if tailLines > 0 && len(allLines) > tailLines {
		allLines = allLines[len(allLines)-tailLines:]
	}

	return allLines, nil
}
