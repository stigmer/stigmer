package root

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

func newServerLogsCommand() *cobra.Command {
	var (
		follow       bool
		lines        int
		component    string
		showStderr   bool
	)

	cmd := &cobra.Command{
		Use:   "logs",
		Short: "View Stigmer server logs",
		Long: `View logs from the Stigmer server daemon.

By default, streams logs in real-time (like kubectl logs -f).
Use --follow=false to disable streaming and only show recent logs.
Use --tail to limit how many existing lines to show before streaming (default: 50).
Use --stderr to view error logs instead of stdout.
Use --component to select which component (server or agent-runner).`,
		Run: func(cmd *cobra.Command, args []string) {
			dataDir, err := config.GetDataDir()
			if err != nil {
				cliprint.PrintError("Failed to determine data directory")
				clierr.Handle(err)
				return
			}

			// Validate component
			if component != "server" && component != "agent-runner" {
				cliprint.PrintError("Invalid component: %s (must be 'server' or 'agent-runner')", component)
				return
			}

			// Determine log file
			logDir := filepath.Join(dataDir, "logs")
			var logFile string
			
			if component == "server" {
				if showStderr {
					logFile = filepath.Join(logDir, "daemon.err")
				} else {
					logFile = filepath.Join(logDir, "daemon.log")
				}
			} else {
				if showStderr {
					logFile = filepath.Join(logDir, "agent-runner.err")
				} else {
					logFile = filepath.Join(logDir, "agent-runner.log")
				}
			}

			// Check if log file exists
			if _, err := os.Stat(logFile); os.IsNotExist(err) {
				cliprint.PrintWarning("Log file does not exist: %s", logFile)
				cliprint.PrintInfo("Server might not have been started yet.")
				return
			}

		// Stream or show logs
		if follow {
			if err := streamLogs(logFile, lines); err != nil {
				cliprint.PrintError("Failed to stream logs")
				clierr.Handle(err)
				return
			}
		} else {
			if err := showLastNLines(logFile, lines); err != nil {
				cliprint.PrintError("Failed to read logs")
				clierr.Handle(err)
				return
			}
		}
		},
	}

	cmd.Flags().BoolVarP(&follow, "follow", "f", true, "Stream logs in real-time (like kubectl logs -f)")
	cmd.Flags().IntVarP(&lines, "tail", "n", 50, "Number of recent lines to show before streaming (0 = all lines)")
	cmd.Flags().StringVarP(&component, "component", "c", "server", "Component to show logs for (server or agent-runner)")
	cmd.Flags().BoolVar(&showStderr, "stderr", false, "Show stderr logs instead of stdout")

	return cmd
}

// streamLogs streams a log file in real-time (like kubectl logs -f)
// First shows existing logs (last n lines if specified, or all if n=0), then streams new ones
func streamLogs(logFile string, tailLines int) error {
	// Open file
	file, err := os.Open(logFile)
	if err != nil {
		return fmt.Errorf("failed to open log file: %w", err)
	}
	defer file.Close()

	// Show file header
	if tailLines == 0 {
		cliprint.PrintInfo("Streaming logs from: %s (showing all existing logs)", logFile)
	} else {
		cliprint.PrintInfo("Streaming logs from: %s (showing last %d lines)", logFile, tailLines)
	}
	cliprint.PrintInfo("Press Ctrl+C to stop")
	fmt.Println()

	// Read and display existing logs
	scanner := bufio.NewScanner(file)
	
	if tailLines == 0 {
		// Show all existing logs
		for scanner.Scan() {
			fmt.Println(scanner.Text())
		}
	} else {
		// Show last N lines using circular buffer
		lines := make([]string, 0, tailLines)
		for scanner.Scan() {
			line := scanner.Text()
			if len(lines) < tailLines {
				lines = append(lines, line)
			} else {
				// Circular buffer: shift and append
				lines = append(lines[1:], line)
			}
		}
		// Print collected lines
		for _, line := range lines {
			fmt.Println(line)
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("error reading existing logs: %w", err)
	}

	// Now we're at the end of existing content, start streaming new logs
	// Get current position (end of file)
	currentPos, err := file.Seek(0, io.SeekCurrent)
	if err != nil {
		return fmt.Errorf("failed to get current position: %w", err)
	}

	// Create new buffered reader for streaming
	reader := bufio.NewReader(file)

	// Poll for new lines
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				// No more data, wait and try again
				time.Sleep(100 * time.Millisecond)
				
				// Re-check file size (in case it was truncated/rotated)
				stat, statErr := file.Stat()
				if statErr == nil {
					newPos, _ := file.Seek(0, io.SeekCurrent)
					if stat.Size() < newPos {
						// File was truncated, seek to beginning
						file.Seek(0, io.SeekStart)
						reader = bufio.NewReader(file)
						currentPos = 0
					}
				}
				continue
			}
			return fmt.Errorf("error reading log file: %w", err)
		}

		// Print line to stdout
		fmt.Print(line)
		
		// Update current position
		currentPos, _ = file.Seek(0, io.SeekCurrent)
	}
}

// showLastNLines shows the last N lines of a file (like tail -n N)
func showLastNLines(logFile string, n int) error {
	// Open file
	file, err := os.Open(logFile)
	if err != nil {
		return fmt.Errorf("failed to open log file: %w", err)
	}
	defer file.Close()

	// Show file header
	cliprint.PrintInfo("Showing last %d lines from: %s", n, logFile)
	fmt.Println()

	// Read all lines into a circular buffer
	lines := make([]string, 0, n)
	scanner := bufio.NewScanner(file)
	
	for scanner.Scan() {
		line := scanner.Text()
		
		if len(lines) < n {
			lines = append(lines, line)
		} else {
			// Circular buffer: shift and append
			lines = append(lines[1:], line)
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("error reading log file: %w", err)
	}

	// Print collected lines
	for _, line := range lines {
		fmt.Println(line)
	}

	return nil
}
