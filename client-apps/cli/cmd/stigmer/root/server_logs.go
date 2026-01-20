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

By default, shows stdout logs from stigmer-server.
Use --stderr to view error logs instead.
Use --component to select which component (server or agent-runner).
Use --follow to stream logs in real-time (like kubectl logs -f).`,
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
				if err := streamLogs(logFile); err != nil {
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

	cmd.Flags().BoolVarP(&follow, "follow", "f", false, "Stream logs in real-time (like tail -f)")
	cmd.Flags().IntVarP(&lines, "tail", "n", 50, "Number of recent lines to show (when not following)")
	cmd.Flags().StringVarP(&component, "component", "c", "server", "Component to show logs for (server or agent-runner)")
	cmd.Flags().BoolVar(&showStderr, "stderr", false, "Show stderr logs instead of stdout")

	return cmd
}

// streamLogs streams a log file in real-time (like tail -f)
func streamLogs(logFile string) error {
	// Open file
	file, err := os.Open(logFile)
	if err != nil {
		return fmt.Errorf("failed to open log file: %w", err)
	}
	defer file.Close()

	// Show file header
	cliprint.PrintInfo("Streaming logs from: %s", logFile)
	cliprint.PrintInfo("Press Ctrl+C to stop")
	fmt.Println()

	// Seek to end of file
	if _, err := file.Seek(0, io.SeekEnd); err != nil {
		return fmt.Errorf("failed to seek to end of file: %w", err)
	}

	// Create buffered reader
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
					pos, _ := file.Seek(0, io.SeekCurrent)
					if stat.Size() < pos {
						// File was truncated, seek to beginning
						file.Seek(0, io.SeekStart)
						reader = bufio.NewReader(file)
					}
				}
				continue
			}
			return fmt.Errorf("error reading log file: %w", err)
		}

		// Print line to stdout
		fmt.Print(line)
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
