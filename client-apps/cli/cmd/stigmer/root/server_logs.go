package root

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/logs"
)

func newServerLogsCommand() *cobra.Command {
	var (
		follow     bool
		lines      int
		component  string
		showStderr bool
		showAll    bool
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
			// If --component is explicitly set, use single-component mode (unless --all is also explicitly set)
			componentExplicitlySet := cmd.Flags().Changed("component")
			allExplicitlySet := cmd.Flags().Changed("all")

			// Use all-components mode if:
			// 1. --all is explicitly set to true, OR
			// 2. Neither --component nor --all was explicitly set (default behavior)
			useAllMode := (allExplicitlySet && showAll) || (!componentExplicitlySet && !allExplicitlySet && showAll)

			if useAllMode {
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
			if component == "agent-runner" && daemon.IsAgentRunnerDocker(dataDir) {
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
	if daemon.IsAgentRunnerDocker(dataDir) {
		components = append(components, logs.ComponentConfig{
			Name:            "agent-runner",
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

// getComponentConfigsWithStreamPreferences returns component configs with smart stream preferences.
// stigmer-server: prefers stderr (zerolog defaults to stderr)
// workflow-runner: prefers stdout (Go's log package defaults to stdout)
// agent-runner: reads from Docker (both streams)
func getComponentConfigsWithStreamPreferences(dataDir, logDir string, useSmartDefaults bool) []logs.ComponentConfig {
	components := []logs.ComponentConfig{
		{
			Name:         "stigmer-server",
			LogFile:      filepath.Join(logDir, "stigmer-server.log"),
			ErrFile:      filepath.Join(logDir, "stigmer-server.err"),
			PreferStderr: false, // Both stdout and stderr are redirected to .log file in daemon.go
		},
		{
			Name:         "workflow-runner",
			LogFile:      filepath.Join(logDir, "workflow-runner.log"),
			ErrFile:      filepath.Join(logDir, "workflow-runner.err"),
			PreferStderr: false, // Both stdout and stderr are redirected to .log file in daemon.go
		},
	}

	// Check if agent-runner is running in Docker
	if daemon.IsAgentRunnerDocker(dataDir) {
		components = append(components, logs.ComponentConfig{
			Name:            "agent-runner",
			DockerContainer: daemon.AgentRunnerContainerName,
			PreferStderr:    false, // Docker logs include both streams
		})
	} else {
		components = append(components, logs.ComponentConfig{
			Name:         "agent-runner",
			LogFile:      filepath.Join(logDir, "agent-runner.log"),
			ErrFile:      filepath.Join(logDir, "agent-runner.err"),
			PreferStderr: false, // agent-runner logs to stdout
		})
	}

	return components
}
