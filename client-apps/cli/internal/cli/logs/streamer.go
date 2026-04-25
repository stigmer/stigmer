package logs

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

// StreamAllLogsWithPreferences streams logs from multiple files using smart stream preferences.
// Each component can specify whether it prefers stderr or stdout.
func StreamAllLogsWithPreferences(components []ComponentConfig, tailLines int) error {
	existingLines, err := MergeLogFilesWithPreferences(components, tailLines)
	if err != nil {
		return err
	}

	PrintMergedLogs(existingLines)

	return streamNewLogsWithPreferences(components)
}

// streamNewLogsWithPreferences starts streaming new log lines using stream preferences
func streamNewLogsWithPreferences(components []ComponentConfig) error {
	linesChan := make(chan LogLine, 100)
	errChan := make(chan error, len(components))
	var wg sync.WaitGroup

	for _, comp := range components {
		logFile := comp.LogFile
		if comp.PreferStderr {
			logFile = comp.ErrFile
		}

		if _, err := os.Stat(logFile); os.IsNotExist(err) {
			continue
		}

		wg.Add(1)
		go func(file, component string) {
			defer wg.Done()
			if err := tailLogFile(file, component, linesChan); err != nil {
				errChan <- fmt.Errorf("%s: %w", component, err)
			}
		}(logFile, comp.Name)
	}

	go func() {
		wg.Wait()
		close(linesChan)
		close(errChan)
	}()

	go func() {
		for line := range linesChan {
			fmt.Println(FormatLogLine(line))
		}
	}()

	for err := range errChan {
		return err
	}

	return nil
}

// tailLogFile tails a single log file and sends new lines to the channel.
// Automatically detects and handles file replacement (e.g., when server restarts).
func tailLogFile(logFile, component string, linesChan chan<- LogLine) error {
	var file *os.File
	var reader *bufio.Reader
	var currentInode uint64

	openFile := func() error {
		if file != nil {
			file.Close()
		}

		var err error
		file, err = os.Open(logFile)
		if err != nil {
			return fmt.Errorf("failed to open log file: %w", err)
		}

		stat, err := file.Stat()
		if err != nil {
			file.Close()
			return fmt.Errorf("failed to stat file: %w", err)
		}
		currentInode = getInode(stat)

		if _, err := file.Seek(0, io.SeekEnd); err != nil {
			file.Close()
			return fmt.Errorf("failed to seek to end: %w", err)
		}

		reader = bufio.NewReader(file)
		return nil
	}

	if err := openFile(); err != nil {
		return err
	}
	defer file.Close()

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				time.Sleep(100 * time.Millisecond)

				stat, statErr := os.Stat(logFile)
				if statErr != nil {
					time.Sleep(500 * time.Millisecond)
					continue
				}

				newInode := getInode(stat)
				if newInode != currentInode {
					if err := openFile(); err != nil {
						time.Sleep(500 * time.Millisecond)
						continue
					}
					continue
				}

				currentPos, _ := file.Seek(0, io.SeekCurrent)
				if stat.Size() < currentPos {
					file.Seek(0, io.SeekStart)
					reader = bufio.NewReader(file)
				}
				continue
			}
			return fmt.Errorf("error reading log file: %w", err)
		}

		if len(line) > 0 && line[len(line)-1] == '\n' {
			line = line[:len(line)-1]
		}

		logLine := ParseLogLine(line, component)
		linesChan <- logLine
	}
}

