package root

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/logs"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// NewLogsCommand creates the top-level 'stigmer logs' command.
func NewLogsCommand() *cobra.Command {
	var (
		follow     bool
		lines      int
		component  string
		showStderr bool
		showAll    bool
	)

	cmd := &cobra.Command{
		Use:   "logs",
		Short: "View service logs",
		Long: `View logs from the Stigmer server daemon.

By default, streams logs in real-time from all components (like kubectl logs -f).
Use --follow=false to disable streaming and only show recent logs.
Use --tail to limit how many existing lines to show before streaming (default: 50).
Use --stderr to view error logs.
Use --component to select a specific component (stigmer-server or runner).
Use --all to view logs from all components in a single interleaved stream.`,
		Example: `  # Stream all logs
  stigmer logs

  # Show last 100 lines without streaming
  stigmer logs --follow=false --tail 100

  # View only runner logs
  stigmer logs --component runner`,
		Run: func(cmd *cobra.Command, args []string) {
			handleLogs(cmd, follow, lines, component, showStderr, showAll)
		},
	}

	cmd.Flags().BoolVarP(&follow, "follow", "f", true, "Stream logs in real-time (like kubectl logs -f)")
	cmd.Flags().IntVarP(&lines, "tail", "n", 50, "Number of recent lines to show before streaming (0 = all lines)")
	cmd.Flags().StringVarP(&component, "component", "c", "stigmer-server", "Component to show logs for (stigmer-server or runner)")
	cmd.Flags().BoolVar(&showStderr, "stderr", false, "Show stderr logs instead of stdout")
	cmd.Flags().BoolVar(&showAll, "all", true, "Show logs from all components (interleaved by timestamp)")

	return cmd
}

func handleLogs(cmd *cobra.Command, follow bool, lines int, component string, showStderr, showAll bool) {
	dataDir, err := config.GetDataDir()
	if err != nil {
		climsg.Error("Failed to determine data directory")
		clierr.Handle(err)
		return
	}

	logDir := filepath.Join(dataDir, "logs")

	componentExplicitlySet := cmd.Flags().Changed("component")
	allExplicitlySet := cmd.Flags().Changed("all")

	useAllMode := (allExplicitlySet && showAll) || (!componentExplicitlySet && !allExplicitlySet && showAll)

	if useAllMode {
		useSmartDefaults := !cmd.Flags().Changed("stderr")
		components := getComponentConfigsWithStreamPreferences(logDir, useSmartDefaults)

		streamType := "mixed (smart defaults)"
		if !useSmartDefaults {
			if showStderr {
				streamType = "stderr"
			} else {
				streamType = "stdout"
			}
		}

		if follow {
			climsg.Info("Streaming logs from all components (%s, interleaved by timestamp)", streamType)
			climsg.Info("Press Ctrl+C to stop")
			fmt.Println()

			if err := logs.StreamAllLogsWithPreferences(components, lines); err != nil {
				climsg.Error("Failed to stream logs")
				clierr.Handle(err)
				return
			}
		} else {
			climsg.Info("Showing last %d lines from all components (%s, interleaved by timestamp)", lines, streamType)
			fmt.Println()

			mergedLines, err := logs.MergeLogFilesWithPreferences(components, lines)
			if err != nil {
				climsg.Error("Failed to read logs")
				clierr.Handle(err)
				return
			}
			logs.PrintMergedLogs(mergedLines)
		}
		return
	}

	if component != "stigmer-server" && component != "runner" {
		climsg.Error("Invalid component: %s (must be 'stigmer-server' or 'runner')", component)
		return
	}

	var logFile string
	if showStderr {
		logFile = filepath.Join(logDir, component+".err")
	} else {
		logFile = filepath.Join(logDir, component+".log")
	}

	if _, err := os.Stat(logFile); os.IsNotExist(err) {
		climsg.Warning("Log file does not exist: %s", logFile)
		climsg.Info("Server might not have been started yet.")
		return
	}

	if follow {
		if err := streamLogs(logFile, lines); err != nil {
			climsg.Error("Failed to stream logs")
			clierr.Handle(err)
			return
		}
	} else {
		if err := showLastNLines(logFile, lines); err != nil {
			climsg.Error("Failed to read logs")
			clierr.Handle(err)
			return
		}
	}
}

func getComponentConfigsWithStreamPreferences(logDir string, useSmartDefaults bool) []logs.ComponentConfig {
	return []logs.ComponentConfig{
		{
			Name:         "stigmer-server",
			LogFile:      filepath.Join(logDir, "stigmer-server.log"),
			ErrFile:      filepath.Join(logDir, "stigmer-server.err"),
			PreferStderr: false,
		},
		{
			Name:         "runner",
			LogFile:      filepath.Join(logDir, "runner.log"),
			ErrFile:      filepath.Join(logDir, "runner.err"),
			PreferStderr: false,
		},
	}
}
