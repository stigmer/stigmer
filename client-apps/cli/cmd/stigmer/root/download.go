package root

import (
	"fmt"
	"strings"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

// NewDownloadCommand creates the unified download command.
func NewDownloadCommand() *cobra.Command {
	var artifactName string
	var outputDir string
	var all bool

	cmd := &cobra.Command{
		Use:   "download <type> <id>",
		Short: "Download artifacts from an execution",
		Long: `Download artifacts produced by an agent execution.

Currently only supports execution type.

Artifacts are files created by the agent during execution (e.g., reports,
processed data, generated code). They are stored in the artifact store
and can be downloaded after the execution completes.`,
		Example: `  # Download all artifacts from an execution
  stigmer download execution aex_01abc123

  # Download to specific directory
  stigmer download execution aex_01abc123 --output-dir ./results

  # Download specific artifact by name
  stigmer download execution aex_01abc123 --artifact report.pdf`,
		Args: cobra.ExactArgs(2),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeDownload(downloadOptions{
				TypeArg:      args[0],
				Reference:    args[1],
				ArtifactName: artifactName,
				OutputDir:    outputDir,
				All:          all,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVar(&artifactName, "artifact", "", "specific artifact to download (by name)")
	cmd.Flags().StringVarP(&outputDir, "output-dir", "o", ".", "output directory for downloaded files")
	cmd.Flags().BoolVar(&all, "all", true, "download all artifacts (default)")

	return cmd
}

// downloadOptions contains options for the download command.
type downloadOptions struct {
	TypeArg      string
	Reference    string
	ArtifactName string
	OutputDir    string
	All          bool
}

// isDownloadExecutionType checks if the type arg refers to executions.
func isDownloadExecutionType(typeArg string) bool {
	normalized := strings.ToLower(strings.TrimSpace(typeArg))
	return normalized == "execution" || normalized == "executions" || normalized == "exec"
}

// executeDownload handles the download command.
func executeDownload(opts downloadOptions) error {
	// Currently only executions support download
	if !isDownloadExecutionType(opts.TypeArg) {
		return fmt.Errorf("download not supported for type: %s\n\nCurrently only 'execution' type supports download", opts.TypeArg)
	}

	// Validate reference is an execution ID
	if !reference.IsAgentExecutionID(opts.Reference) {
		return fmt.Errorf("invalid execution ID: %s\n\nExecutions must be referenced by ID (e.g., aex_01abc123)", opts.Reference)
	}

	// Setup backend connection
	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}

	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return errors.Wrap(err, "failed to get data directory")
		}
		if err := daemon.EnsureRunning(dataDir); err != nil {
			return errors.Wrap(err, "failed to start daemon")
		}
	}

	client, err := backend.NewStigmerClient()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()
	conn := client.Conn().(*grpc.ClientConn)

	// Download execution artifacts
	return downloadExecutionArtifacts(opts.Reference, opts, conn)
}
