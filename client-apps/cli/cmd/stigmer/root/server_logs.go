package root

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/logs"
)

func newServerLogsCommand() *cobra.Command {
	var (
		follow       bool
		lines        int
		component    string
		showStderr   bool
		showAll      bool
	)

	cmd := &cobra.Command{
		Use:   "logs",
		Short: "View Stigmer server logs",
		Long: `View logs from the Stigmer server daemon.

By default, streams logs in real-time from all components (like kubectl logs -f).
Use --follow=false to disable streaming and only show recent logs.
Use --tail to limit how many existing lines to show before streaming (default: 50).
Use --stderr to view error logs (note: stigmer-server logs go to stderr by default).
Use --component to select a specific component (stigmer-server, agent-runner, or workflow-runner).
Use --all to view logs from all components in a single interleaved stream (defaults to stderr).`,
		Run: func(cmd *cobra.Command, args []string) {
			dataDir, err := config.GetDataDir()
			if err != nil {
				cliprint.PrintError("Failed to determine data directory")
				clierr.Handle(err)
				return
			}

			logDir := filepath.Join(dataDir, "logs")

			// Handle --all flag: show logs from all components
			if showAll {
				// Smart defaults: use the stream that actually has logs for each component
				// - stigmer-server: stderr (zerolog defaults to stderr)
				// - workflow-runner: stdout (Go's log package defaults to stdout)
				// - agent-runner: both stdout and stderr from Docker
				// If user explicitly set --stderr, respect that for all components
				useSmartDefaults := !cmd.Flags().Changed("stderr")
				
				components := getComponentConfigsWithStreamPreferences(dataDir, logDir, useSmartDefaults)
				
				streamType := "mixed (smart defaults)"
				if !useSmartDefaults {
					if showStderr {
						streamType = "stderr"
					} else {
						streamType = "stdout"
					}
				}
				
				if follow {
					cliprint.PrintInfo("Streaming logs from all components (%s, interleaved by timestamp)", streamType)
					cliprint.PrintInfo("Press Ctrl+C to stop")
					fmt.Println()
					
					if err := logs.StreamAllLogsWithPreferences(components, lines); err != nil {
						cliprint.PrintError("Failed to stream logs")
						clierr.Handle(err)
						return
					}
				} else {
					cliprint.PrintInfo("Showing last %d lines from all components (%s, interleaved by timestamp)", lines, streamType)
					fmt.Println()
					
					mergedLines, err := logs.MergeLogFilesWithPreferences(components, lines)
					if err != nil {
						cliprint.PrintError("Failed to read logs")
						clierr.Handle(err)
						return
					}
					logs.PrintMergedLogs(mergedLines)
				}
				return
			}

			// Original single-component logic
			// Validate component
			if component != "stigmer-server" && component != "agent-runner" && component != "workflow-runner" {
				cliprint.PrintError("Invalid component: %s (must be 'stigmer-server', 'agent-runner', or 'workflow-runner')", component)
				return
			}

			// Special handling for agent-runner: check if running in Docker
			if component == "agent-runner" && isAgentRunnerDocker(dataDir) {
				cliprint.PrintInfo("Agent-runner is running in Docker, streaming from container")
				if err := streamDockerLogs(daemon.AgentRunnerContainerName, follow, lines); err != nil {
					cliprint.PrintError("Failed to stream Docker logs")
					clierr.Handle(err)
					return
				}
				return
			}

			// Determine log file
			var logFile string
			
			if component == "stigmer-server" {
				if showStderr {
					logFile = filepath.Join(logDir, "stigmer-server.err")
				} else {
					logFile = filepath.Join(logDir, "stigmer-server.log")
				}
			} else if component == "agent-runner" {
				if showStderr {
					logFile = filepath.Join(logDir, "agent-runner.err")
				} else {
					logFile = filepath.Join(logDir, "agent-runner.log")
				}
			} else {
				// workflow-runner
				if showStderr {
					logFile = filepath.Join(logDir, "workflow-runner.err")
				} else {
					logFile = filepath.Join(logDir, "workflow-runner.log")
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
	cmd.Flags().StringVarP(&component, "component", "c", "stigmer-server", "Component to show logs for (stigmer-server, agent-runner, or workflow-runner)")
	cmd.Flags().BoolVar(&showStderr, "stderr", false, "Show stderr logs instead of stdout (note: stigmer-server logs go to stderr)")
	cmd.Flags().BoolVar(&showAll, "all", true, "Show logs from all components (interleaved by timestamp, defaults to stderr)")

	return cmd
}

// getComponentConfigs returns the log file configuration for all components
func getComponentConfigs(dataDir, logDir string) []logs.ComponentConfig {
	components := []logs.ComponentConfig{
		{
			Name:    "stigmer-server",
			LogFile: filepath.Join(logDir, "stigmer-server.log"),
			ErrFile: filepath.Join(logDir, "stigmer-server.err"),
		},
		{
			Name:    "workflow-runner",
			LogFile: filepath.Join(logDir, "workflow-runner.log"),
			ErrFile: filepath.Join(logDir, "workflow-runner.err"),
		},
	}
	
	// Check if agent-runner is running in Docker
	if isAgentRunnerDocker(dataDir) {
		components = append(components, logs.ComponentConfig{
			Name:           "agent-runner",
			DockerContainer: daemon.AgentRunnerContainerName,
		})
	} else {
		components = append(components, logs.ComponentConfig{
			Name:    "agent-runner",
			LogFile: filepath.Join(logDir, "agent-runner.log"),
			ErrFile: filepath.Join(logDir, "agent-runner.err"),
		})
	}
	
	return components
}

// getComponentConfigsWithStreamPreferences returns component configs with smart stream preferences
// stigmer-server: prefers stderr (zerolog defaults to stderr)
// workflow-runner: prefers stdout (Go's log package defaults to stdout)
// agent-runner: reads from Docker (both streams)
func getComponentConfigsWithStreamPreferences(dataDir, logDir string, useSmartDefaults bool) []logs.ComponentConfig {
	components := []logs.ComponentConfig{
		{
			Name:           "stigmer-server",
			LogFile:        filepath.Join(logDir, "stigmer-server.log"),
			ErrFile:        filepath.Join(logDir, "stigmer-server.err"),
			PreferStderr:   useSmartDefaults, // stigmer-server logs to stderr by default
		},
		{
			Name:           "workflow-runner",
			LogFile:        filepath.Join(logDir, "workflow-runner.log"),
			ErrFile:        filepath.Join(logDir, "workflow-runner.err"),
			PreferStderr:   false, // workflow-runner logs to stdout (Go log package default)
		},
	}
	
	// Check if agent-runner is running in Docker
	if isAgentRunnerDocker(dataDir) {
		components = append(components, logs.ComponentConfig{
			Name:           "agent-runner",
			DockerContainer: daemon.AgentRunnerContainerName,
			PreferStderr:   false, // Docker logs include both streams
		})
	} else {
		components = append(components, logs.ComponentConfig{
			Name:           "agent-runner",
			LogFile:        filepath.Join(logDir, "agent-runner.log"),
			ErrFile:        filepath.Join(logDir, "agent-runner.err"),
			PreferStderr:   false, // agent-runner logs to stdout
		})
	}
	
	return components
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
	// Ensure we're at the end of the file (position reader correctly after scanner)
	if _, err := file.Seek(0, io.SeekCurrent); err != nil {
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

// isAgentRunnerDocker checks if agent-runner is running in Docker
func isAgentRunnerDocker(dataDir string) bool {
	// Check if container ID file exists
	containerIDFile := filepath.Join(dataDir, daemon.AgentRunnerContainerIDFileName)
	if _, err := os.Stat(containerIDFile); err == nil {
		return true
	}
	
	// Fallback: check if container exists by name
	cmd := exec.Command("docker", "ps", "-q", "-f", fmt.Sprintf("name=^%s$", daemon.AgentRunnerContainerName))
	output, err := cmd.Output()
	return err == nil && len(output) > 0
}

// streamDockerLogs streams logs from a Docker container
func streamDockerLogs(containerName string, follow bool, tailLines int) error {
	args := []string{"logs"}
	
	if follow {
		args = append(args, "-f")
	}
	
	if tailLines > 0 {
		args = append(args, "--tail", strconv.Itoa(tailLines))
	}
	
	args = append(args, containerName)
	
	cliprint.PrintInfo("Streaming logs from Docker container: %s", containerName)
	if follow {
		cliprint.PrintInfo("Press Ctrl+C to stop")
	}
	fmt.Println()
	
	cmd := exec.Command("docker", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	
	return cmd.Run()
}
