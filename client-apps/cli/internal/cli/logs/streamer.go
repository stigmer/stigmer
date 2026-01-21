package logs

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"
)

// StreamAllLogs streams logs from multiple files in real-time
func StreamAllLogs(components []ComponentConfig, showStderr bool, tailLines int) error {
	// First, show existing logs (merged and sorted)
	existingLines, err := MergeLogFiles(components, showStderr, tailLines)
	if err != nil {
		return err
	}

	// Print existing logs
	PrintMergedLogs(existingLines)

	// Now start streaming new logs from all files
	return streamNewLogs(components, showStderr)
}

// streamNewLogs starts streaming new log lines from all component files
func streamNewLogs(components []ComponentConfig, showStderr bool) error {
	// Channel for receiving new log lines from all components
	linesChan := make(chan LogLine, 100)
	errChan := make(chan error, len(components))
	var wg sync.WaitGroup

	// Start a goroutine for each component to tail its log file or Docker container
	for _, comp := range components {
		// Docker container takes precedence
		if comp.DockerContainer != "" {
			wg.Add(1)
			go func(containerName, component string) {
				defer wg.Done()
				if err := tailDockerLogs(containerName, component, linesChan); err != nil {
					errChan <- fmt.Errorf("%s: %w", component, err)
				}
			}(comp.DockerContainer, comp.Name)
			continue
		}

		// File-based logging
		logFile := comp.LogFile
		if showStderr {
			logFile = comp.ErrFile
		}

		// Check if file exists before starting goroutine
		if _, err := os.Stat(logFile); os.IsNotExist(err) {
			continue // Skip non-existent files
		}

		wg.Add(1)
		go func(file, component string) {
			defer wg.Done()
			if err := tailLogFile(file, component, linesChan); err != nil {
				errChan <- fmt.Errorf("%s: %w", component, err)
			}
		}(logFile, comp.Name)
	}

	// Goroutine to close channels when all tailers are done
	go func() {
		wg.Wait()
		close(linesChan)
		close(errChan)
	}()

	// Print lines as they arrive
	go func() {
		for line := range linesChan {
			fmt.Println(FormatLogLine(line))
		}
	}()

	// Wait for any errors
	for err := range errChan {
		return err
	}

	return nil
}

// tailLogFile tails a single log file and sends new lines to the channel
func tailLogFile(logFile, component string, linesChan chan<- LogLine) error {
	file, err := os.Open(logFile)
	if err != nil {
		return fmt.Errorf("failed to open log file: %w", err)
	}
	defer file.Close()

	// Seek to end of file to only capture new logs
	if _, err := file.Seek(0, io.SeekEnd); err != nil {
		return fmt.Errorf("failed to seek to end: %w", err)
	}

	reader := bufio.NewReader(file)

	// Poll for new lines
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				// No more data, wait and try again
				time.Sleep(100 * time.Millisecond)

				// Check if file was truncated/rotated
				stat, statErr := file.Stat()
				if statErr == nil {
					currentPos, _ := file.Seek(0, io.SeekCurrent)
					if stat.Size() < currentPos {
						// File was truncated, seek to beginning
						file.Seek(0, io.SeekStart)
						reader = bufio.NewReader(file)
					}
				}
				continue
			}
			return fmt.Errorf("error reading log file: %w", err)
		}

		// Remove trailing newline
		if len(line) > 0 && line[len(line)-1] == '\n' {
			line = line[:len(line)-1]
		}

		// Parse and send log line
		logLine := ParseLogLine(line, component)
		linesChan <- logLine
	}
}

// tailDockerLogs tails logs from a Docker container and sends lines to the channel
func tailDockerLogs(containerName, component string, linesChan chan<- LogLine) error {
	ctx := context.Background()
	
	// Use docker logs -f to follow container logs
	cmd := exec.CommandContext(ctx, "docker", "logs", "-f", "--tail", "0", containerName)
	
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}
	
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start docker logs: %w", err)
	}
	
	// Read from both stdout and stderr
	var wg sync.WaitGroup
	wg.Add(2)
	
	// Read stdout
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			logLine := ParseLogLine(line, component)
			linesChan <- logLine
		}
	}()
	
	// Read stderr
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			logLine := ParseLogLine(line, component)
			linesChan <- logLine
		}
	}()
	
	// Wait for readers to finish
	wg.Wait()
	
	// Wait for command to exit
	return cmd.Wait()
}
