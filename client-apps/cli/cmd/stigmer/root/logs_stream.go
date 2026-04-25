package root

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// streamLogs streams a log file in real-time (like kubectl logs -f).
// First shows existing logs (last n lines if specified, or all if n=0),
// then streams new ones. Handles file replacement (e.g., server restart)
// by detecting inode changes.
func streamLogs(logFile string, tailLines int) error {
	file, err := os.Open(logFile)
	if err != nil {
		return fmt.Errorf("failed to open log file: %w", err)
	}
	defer func() { file.Close() }()

	if tailLines == 0 {
		climsg.Info("Streaming logs from: %s (showing all existing logs)", logFile)
	} else {
		climsg.Info("Streaming logs from: %s (showing last %d lines)", logFile, tailLines)
	}
	climsg.Info("Press Ctrl+C to stop")
	fmt.Println()

	scanner := bufio.NewScanner(file)
	if tailLines == 0 {
		for scanner.Scan() {
			fmt.Println(scanner.Text())
		}
	} else {
		lines := make([]string, 0, tailLines)
		for scanner.Scan() {
			line := scanner.Text()
			if len(lines) < tailLines {
				lines = append(lines, line)
			} else {
				lines = append(lines[1:], line)
			}
		}
		for _, line := range lines {
			fmt.Println(line)
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("error reading existing logs: %w", err)
	}

	if _, err := file.Seek(0, io.SeekEnd); err != nil {
		return fmt.Errorf("failed to seek to end: %w", err)
	}

	stat, err := file.Stat()
	if err != nil {
		return fmt.Errorf("failed to stat file: %w", err)
	}
	currentInode := getInode(stat)

	reader := bufio.NewReader(file)

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				time.Sleep(100 * time.Millisecond)

				pathStat, statErr := os.Stat(logFile)
				if statErr != nil {
					time.Sleep(500 * time.Millisecond)
					continue
				}

				newInode := getInode(pathStat)
				if newInode != currentInode {
					file.Close()
					file, err = os.Open(logFile)
					if err != nil {
						time.Sleep(500 * time.Millisecond)
						continue
					}
					stat, _ := file.Stat()
					currentInode = getInode(stat)
					reader = bufio.NewReader(file)
					continue
				}

				currentPos, _ := file.Seek(0, io.SeekCurrent)
				if pathStat.Size() < currentPos {
					file.Seek(0, io.SeekStart)
					reader = bufio.NewReader(file)
				}
				continue
			}
			return fmt.Errorf("error reading log file: %w", err)
		}

		fmt.Print(line)
	}
}


// showLastNLines shows the last N lines of a file (like tail -n N).
func showLastNLines(logFile string, n int) error {
	file, err := os.Open(logFile)
	if err != nil {
		return fmt.Errorf("failed to open log file: %w", err)
	}
	defer file.Close()

	climsg.Info("Showing last %d lines from: %s", n, logFile)
	fmt.Println()

	lines := make([]string, 0, n)
	scanner := bufio.NewScanner(file)

	for scanner.Scan() {
		line := scanner.Text()

		if len(lines) < n {
			lines = append(lines, line)
		} else {
			lines = append(lines[1:], line)
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("error reading log file: %w", err)
	}

	for _, line := range lines {
		fmt.Println(line)
	}

	return nil
}
